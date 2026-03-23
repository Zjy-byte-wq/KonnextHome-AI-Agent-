import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DynamicStructuredTool, StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { Language } from '@prisma/client';
import sharp from 'sharp';
import { DeviceManagerService } from '../../../device_manager/device_manager.service';
import { ChatbotCameraMetadataDto } from '../../../device_manager/camera/models/chatbot_camera.model';
import { HttpClientService } from '../../../http_client/http_client.service';

interface ToolDescription {
  name: string;
  description: string;
  schema?: any;
}

@Injectable()
export class CameraToolProvider {
  private toolDescriptionCache: Map<string, ToolDescription> = new Map();

  constructor(
    @InjectPinoLogger(CameraToolProvider.name)
    private readonly logger: PinoLogger,
    private readonly deviceManager: DeviceManagerService,
    private readonly httpClientService: HttpClientService,
  ) {}

  private async composeGrid(
    images: { buffer: Buffer; cameraId: string }[],
    options?: { maxWidth?: number; maxHeight?: number; background?: string; quality?: number },
  ): Promise<{
    buffer: Buffer;
    regions: { cameraId: string; index: number; bbox: { x: number; y: number; width: number; height: number } }[];
  }> {
    if (!images.length) {
      throw new Error('No images to compose');
    }

    const maxWidth = options?.maxWidth ?? 2048;
    const maxHeight = options?.maxHeight ?? 2048;
    const background = options?.background ?? '#ffffff';
    const quality = options?.quality ?? 80;

    const cols = Math.ceil(Math.sqrt(images.length));
    const rows = Math.ceil(images.length / cols);
    const cellWidth = Math.max(1, Math.floor(maxWidth / cols));
    const cellHeight = Math.max(1, Math.floor(maxHeight / rows));

    const composites: sharp.OverlayOptions[] = [];
    const regions: { cameraId: string; index: number; bbox: { x: number; y: number; width: number; height: number } }[] =
      [];

    for (let i = 0; i < images.length; i++) {
      const { buffer, cameraId } = images[i];
      const left = (i % cols) * cellWidth;
      const top = Math.floor(i / cols) * cellHeight;

      const { data, info } = await sharp(buffer)
        .resize({
          width: cellWidth,
          height: cellHeight,
          fit: 'inside',
        })
        .jpeg({ quality })
        .toBuffer({ resolveWithObject: true });

      composites.push({
        input: data,
        left,
        top,
      });

      regions.push({
        cameraId,
        index: i,
        bbox: {
          x: left,
          y: top,
          width: info.width,
          height: info.height,
        },
      });
    }

    const canvasWidth = cols * cellWidth;
    const canvasHeight = rows * cellHeight;

    const { data: merged } = await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 3,
        background,
      },
    })
      .composite(composites)
      .jpeg({ quality })
      .toBuffer({ resolveWithObject: true });

    return { buffer: merged, regions };
  }

  private getOrCreateToolDescription(key: string, createFn: () => ToolDescription): ToolDescription {
    if (this.toolDescriptionCache.has(key)) {
      this.logger.debug(`Tool description cache hit for: ${key}`);
      return this.toolDescriptionCache.get(key)!;
    }

    this.logger.debug(`Tool description cache miss for: ${key}, creating new description`);
    const description = createFn();
    this.toolDescriptionCache.set(key, description);
    return description;
  }

  private getCameraSnapshotDescription(language: string): ToolDescription {
    const cacheKey = `camera_snapshot_${language}`;
    return this.getOrCreateToolDescription(cacheKey, () => {
      const description =
        language === 'zh_CN'
          ? '当用户询问“获取当前摄像头快照”时，调用此函数。支持传单个cameraId（单帧）或多个cameraIds/同一路多帧进行拼图。'
          : `Call this function to get a snapshot image. Supports a single cameraId (single frame) or multiple cameraIds / multi-frame from one camera to compose a collage.
      Provide cameraId to fetch one snapshot immediately, or cameraIds (>=2) to compose.
      If cameraId is invalid -> CAMERA_NOT_FOUND.
      If camera is offline -> CAMERA_OFFLINE.
      Use when user wants to view a live or recent image of a camera`;

      return {
        name: 'get_camera_snapshot',
        description,
        schema: z.object({
          cameraId: z.string().describe('ID of the camera to fetch snapshot from').optional(),
          cameraIds: z
            .array(z.string())
            .min(1)
            .describe('IDs of cameras to fetch snapshots and compose; length >= 2 will be collage')
            .optional(),
          frameCount: z
            .number()
            .int()
            .min(1)
            .max(10)
            .describe('When provided with cameraId, capture multiple frames from the same camera for collage')
            .optional(),
        }).refine((data) => Boolean(data.cameraId) || (Array.isArray(data.cameraIds) && data.cameraIds.length > 0), {
          message: 'cameraId or cameraIds is required',
          path: ['cameraId'],
        }),
      };
    });
  }

  async generateCameraContext(userId: string): Promise<string> {
    try {
      const cameras = await this.deviceManager.getCameraMetaData(userId);
      if (!cameras || cameras.length === 0) return '';

      let text = '\n\n=== CAMERAS ===\nHere are the available cameras in your home:\n';
      for (const camera of cameras) {
        text += `  - Camera ID: ${camera.id}, Name: "${camera.name}"\n`;
      }

      text += '\nYou can use the following tools:\n';
      text += `get_camera_snapshot: single snapshot by cameraId; or pass cameraIds (>=2) / cameraId+frameCount (>=2) to compose a collage.\n`;
      return text;
    } catch (err) {
      this.logger.warn('genCameraContext error for user:', err);
      return '';
    }
  }

  async generateCameraTools(userId: string, language: Language): Promise<StructuredToolInterface[]> {
    const tools: DynamicStructuredTool[] = [];

    try {
      const CameraSnapshotDesc = this.getCameraSnapshotDescription(language);
      tools.push(
        new DynamicStructuredTool({
          name: CameraSnapshotDesc.name,
          description: CameraSnapshotDesc.description,
          schema: CameraSnapshotDesc.schema,
          func: async ({
            cameraId,
            cameraIds,
            frameCount,
          }: {
            cameraId?: string;
            cameraIds?: string[];
            frameCount?: number;
          }): Promise<string> => {
            const normalizedFrameCount = frameCount && frameCount > 0 ? Math.min(frameCount, 10) : 1;
            const isMultiCamera = Array.isArray(cameraIds) && cameraIds.length > 1;
            const primaryCameraId = cameraId ?? (Array.isArray(cameraIds) && cameraIds.length === 1 ? cameraIds[0] : undefined);
            const isMultiFrameSameCamera = !isMultiCamera && !!primaryCameraId && normalizedFrameCount > 1;
            const isCollage = isMultiCamera || isMultiFrameSameCamera;
            this.logger.info(
              isCollage
                ? `tool used: get_camera_snapshot (collage mode) for ${isMultiCamera ? `cameras ${cameraIds?.join(',')}` : `camera ${primaryCameraId} with ${normalizedFrameCount} frames`}`
                : `tool used: get_camera_snapshot for camera ${primaryCameraId}`,
            );
            try {
              const cameras: ChatbotCameraMetadataDto[] = await this.deviceManager.getCameraMetaData(userId);

              if (isCollage) {
                const available = Array.isArray(cameras) ? cameras : [];
                let targets: ChatbotCameraMetadataDto[] = [];

                if (isMultiCamera) {
                  targets = available.filter((c) => cameraIds?.includes(c.id));
                } else if (isMultiFrameSameCamera && primaryCameraId) {
                  const target = available.find((c) => c.id === primaryCameraId);
                  if (target) targets = [target];
                }

                if (!targets.length) {
                  return JSON.stringify({
                    success: false,
                    code: 'CAMERA_NOT_FOUND',
                    message: 'No valid cameraId provided.',
                  });
                }

                const snapshots: { buffer: Buffer; cameraId: string }[] = [];
                for (const target of targets) {
                  const times = isMultiFrameSameCamera ? normalizedFrameCount : 1;
                  for (let i = 0; i < times; i++) {
                    const buffer = await this.deviceManager.getCameraSnapshot(target.id);
                    if (buffer && buffer.length > 0) {
                      snapshots.push({ buffer, cameraId: target.id });
                    } else {
                      this.logger.warn(`Camera ${target.id} snapshot unavailable, skipped in collage`);
                    }
                  }
                }

                if (!snapshots.length) {
                  return JSON.stringify({
                    success: false,
                    code: 'CAMERA_OFFLINE',
                    message: 'No available snapshots to compose.',
                  });
                }

                const { buffer: mergedBuffer, regions } = await this.composeGrid(snapshots);
                const base64 = mergedBuffer.toString('base64');
                const dataUrl = `data:image/jpeg;base64,${base64}`;
                const messageText = `Collage fetched successfully for ${snapshots.length} snapshot(s).`;

                let cloudUrl: string | undefined;
                try {
                  const uploadRes = await this.httpClientService.konnextonlinePost(
                    '/local_server/upload_snapshot',
                    { base64Image: dataUrl },
                    true,
                  );
                  if (uploadRes?.data?.code === 'K_20000' && uploadRes.data.data) {
                    cloudUrl = uploadRes.data.data as string;
                  } else {
                    this.logger.warn(
                      `upload_snapshot returned unexpected response (collage): ${JSON.stringify(uploadRes?.data)}`,
                    );
                  }
                } catch (uploadErr) {
                  this.logger.error(
                    `upload_snapshot error (collage): ${uploadErr instanceof Error ? uploadErr.message : uploadErr}`,
                  );
                }

                return JSON.stringify({
                  success: true,
                  code: 'OK',
                  cameraIds: snapshots.map((s) => s.cameraId),
                  contentType: 'image/jpeg',
                  data: base64,
                  cloudUrl,
                  size: mergedBuffer.length,
                  regions,
                  message: messageText,
                  openaiContent: [
                    { type: 'text', text: `${messageText} Regions metadata attached.` },
                    {
                      type: 'image_url',
                      image_url: {
                        url: cloudUrl || dataUrl,
                        detail: 'auto',
                      },
                    },
                  ],
                  langchainContent: [
                    { type: 'text', text: `${messageText} Regions metadata attached.` },
                    { type: 'image_url', image_url: { url: cloudUrl || dataUrl } },
                  ],
                });
              }

              const singleCameraId = primaryCameraId;

              if (!singleCameraId) {
                return JSON.stringify({
                  success: false,
                  code: 'CAMERA_NOT_FOUND',
                  message: 'CameraId is required.',
                });
              }

              const target = Array.isArray(cameras) ? cameras.find((c) => c.id === singleCameraId) : undefined;
              if (!target) {
                return JSON.stringify({
                  success: false,
                  code: 'CAMERA_NOT_FOUND',
                  message: 'CameraId is invalid.',
                });
              }

              const buffer: Buffer = await this.deviceManager.getCameraSnapshot(singleCameraId);
              if (!buffer || buffer.length === 0) {
                return JSON.stringify({
                  success: false,
                  code: 'CAMERA_OFFLINE',
                  message: 'Camera is offline or snapshot unavailable.',
                });
              }

              const base64 = buffer.toString('base64');
              const dataUrl = `data:image/jpeg;base64,${base64}`;
              const messageText = `Snapshot fetched successfully for camera "${target.name}".`;

              // Upload to cloud and get accessible URL
              let cloudUrl: string | undefined;
              try {
                const uploadRes = await this.httpClientService.konnextonlinePost(
                  '/local_server/upload_snapshot',
                  { base64Image: dataUrl },
                  true,
                );
                if (uploadRes?.data?.code === 'K_20000' && uploadRes.data.data) {
                  cloudUrl = uploadRes.data.data as string;
                } else {
                  this.logger.warn(
                    `upload_snapshot returned unexpected response: ${JSON.stringify(uploadRes?.data)}`,
                  );
                }
              } catch (uploadErr) {
                this.logger.error(`upload_snapshot error: ${uploadErr instanceof Error ? uploadErr.message : uploadErr}`);
              }

              return JSON.stringify({
                success: true,
                code: 'OK',
                cameraId: singleCameraId,
                name: target.name,
                contentType: 'image/jpeg',
                data: base64,
                cloudUrl,
                size: buffer.length,
                message: messageText,
                openaiContent: [
                  { type: 'text', text: messageText },
                  {
                    type: 'image_url',
                    image_url: {
                      url: cloudUrl || dataUrl,
                      detail: 'auto',
                    },
                  },
                ],
                langchainContent: [
                  { type: 'text', text: messageText },
                  { type: 'image_url', image_url: { url: cloudUrl || dataUrl } },
                ],
              });
            } catch (e) {
              this.logger.error(`get_camera_snapshot error: ${e instanceof Error ? e.message : e}`);
              return JSON.stringify({
                success: false,
                code: 'INTERNAL_ERROR',
                message: 'Error occurred while getting camera snapshot.',
              });
            }
          },
        }),
      );
    } catch (error) {
      this.logger.error(`Error generating camera tools: ${error}`);
    }

    return tools;
  }

  clearCache(): void {
    this.toolDescriptionCache.clear();
  }
}
