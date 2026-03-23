import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DynamicStructuredTool, StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { Language } from '@prisma/client';
import { DeviceManagerService } from '../../../device_manager/device_manager.service';
import { ChatbotCameraMetadataDto } from '../../../device_manager/camera/models/chatbot_camera.model';
import sharp from 'sharp';  // 新增 sharp 依赖 //

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
  ) {}

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
          ? '当用户询问“获取当前摄像头快照”时，调用此函数。'
          : `Call this function to get a snapshot image from the specific camera.
      Provide cameraId to fetch the snapshot immediately.
      If cameraId is invalid -> CAMERA_NOT_FOUND.
      If camera is offline -> CAMERA_OFFLINE.
      Use when user wants to view a live or recent image of a camera`;

      return {
        name: 'get_camera_snapshot',
        description,
        schema: z.object({
          cameraId: z.string().describe('ID of the camera to fetch snapshot from'),
        }),
      };
    });
  }

  // 新增拼图描述 //
  private getCameraStitchDescription(language: string): ToolDescription {
    const cacheKey = `camera_stitch_${language}`;
    return this.getOrCreateToolDescription(cacheKey, () => {
      const description =
        language === 'zh_CN'
          ? '当需要将多路摄像头画面拼接成一张图时调用此函数。传入 cameraIds 列表，按 layout 组合成网格图，返回合成后的图片。'
          : 'Call this function to stitch multiple camera snapshots into one grid image. Provide a list of cameraIds and an optional layout to merge them.';

      return {
        name: 'stitch_camera_images',
        description,
        schema: z.object({
          cameraIds: z.array(z.string()).min(1).describe('List of camera IDs to stitch'),
          layout: z
            .enum(['auto', '2x2', '1xN', 'Nx1'])
            .optional()
            .describe('Grid layout strategy; auto chooses based on count'),
          intervalSeconds: z
            .number()
            .optional()
            .describe('Optional sync interval; ignore if snapshots are immediate'),
          outputFormat: z
            .enum(['jpeg', 'png'])
            .optional()
            .describe('Output image format; default jpeg'),
        }),
      };
    });
  }

  // 用sharp实现拼图功能 //
  private async stitchCameraSnapshots(
    buffers: Buffer[],
    layout: 'auto' | '2x2' | '1xN' | 'Nx1' = 'auto',// 布局方式
    outputFormat: 'jpeg' | 'png' = 'jpeg',// 默认jpg格式
  ): Promise<Buffer> {
    if (!buffers.length) throw new Error('No buffers to stitch');

    const count = buffers.length;
    const grid = (() => {
      switch (layout) {
        // 若用户指定下列布局，则按指定布局生成
        case '2x2':
          return { cols: 2, rows: Math.ceil(count / 2) };//向上取整
        case '1xN':
          return { cols: count, rows: 1 };
        case 'Nx1':
          return { cols: 1, rows: count };
        case 'auto':
        // 若用户没有指定布局，则自动计算一个接近正方形的布局
        default: {
          const cols = Math.ceil(Math.sqrt(count));
          const rows = Math.ceil(count / cols);
          return { cols, rows };
        }
      }
    })();

    const metas = await Promise.all(buffers.map((b) => sharp(b).metadata())); // metas存放每个图像的元数据
    const widths = metas.map((m) => m.width || 0); // 遍历metas获取宽度数组(无法识别则为0)
    const heights = metas.map((m) => m.height || 0); // 遍历metas获取高度数组(无法识别则为0)
    const cellW = Math.max(...widths, 640); // 图像宽度>=640 pixels
    const cellH = Math.max(...heights, 480); // 图像高度>=480 pixels

    const resized = await Promise.all(
      buffers.map((b) => sharp(b).resize(cellW, cellH, { fit: 'cover' }).toBuffer()), //resize到统一大小
    );

    const composites = resized.map((buf, idx) => {
      const col = idx % grid.cols; //当前idx图像的列号
      const row = Math.floor(idx / grid.cols);  //当前idx图像的行号
      return { input: buf, left: col * cellW, top: row * cellH } as const; // 调整后图片的buffer和位置坐标(left, top)
    });

    const width = grid.cols * cellW;  //拼接后图像的总宽度
    const height = grid.rows * cellH; //拼接后图像的总高度

    const canvas = sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },  // 创建一个黑色背景的画布
    });

    const format = outputFormat === 'jpeg' ? 'jpeg' : 'png';
    return canvas
      .composite(composites)
      .toFormat(format)
      .toBuffer();
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
      text += `get_camera_snapshot: to get the current snapshot from the specific Camera ID.\n`;
      text += `stitch_camera_images: merge multiple camera snapshots into one grid (pass cameraIds).\n`;  //新增拼图工具上下文
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
          func: async ({ cameraId }: { cameraId: string }): Promise<string> => {
            this.logger.info(`tool used: get_camera_snapshot for camera ${cameraId}`);
            try {
              const cameras: ChatbotCameraMetadataDto[] = await this.deviceManager.getCameraMetaData(userId);
              const target = Array.isArray(cameras) ? cameras.find((c) => c.id === cameraId) : undefined;
              if (!target) {
                return JSON.stringify({
                  success: false,
                  code: 'CAMERA_NOT_FOUND',
                  message: 'CameraId is invalid.',
                });
              }

              const buffer: Buffer = await this.deviceManager.getCameraSnapshot(cameraId);
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

              return JSON.stringify({
                success: true,
                code: 'OK',
                cameraId,
                name: target.name,
                contentType: 'image/jpeg',
                data: base64,
                size: buffer.length,
                message: messageText,
                // Keep LLM payload small: only text, do not embed base64
                openaiContent: [{ type: 'text', text: messageText }],
                langchainContent: [{ type: 'text', text: messageText }],
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
      // 新增拼图工具 //
      const CameraStitchDesc = this.getCameraStitchDescription(language);
      tools.push(
        new DynamicStructuredTool({
          name: CameraStitchDesc.name,
          description: CameraStitchDesc.description,
          schema: CameraStitchDesc.schema,
          func: async ({
            cameraIds,
            layout = 'auto',
            intervalSeconds,
            outputFormat = 'jpeg',
          }: {
            cameraIds: string[];
            layout?: 'auto' | '2x2' | '1xN' | 'Nx1';
            intervalSeconds?: number;
            outputFormat?: 'jpeg' | 'png';
          }): Promise<string> => {
            this.logger.info(`tool used: stitch_camera_images for cameras: ${cameraIds.join(',')}`);
            try {
              if (!Array.isArray(cameraIds) || cameraIds.length === 0) {
                return JSON.stringify({
                  success: false,
                  code: 'INVALID_INPUT',
                  message: 'cameraIds is required and must be a non-empty array.',
                });
              }

              const cameras: ChatbotCameraMetadataDto[] = await this.deviceManager.getCameraMetaData(userId);
              const targets = cameraIds
                .map((id) => ({ id, meta: cameras?.find((c) => c.id === id) })) //返回{id, meta}对象
                .filter(({ meta }) => !!meta);  //强制转换为布尔值，过滤掉meta为undefined的项-->保持和数据库对齐

              if (targets.length !== cameraIds.length) {
                const missing = cameraIds.filter((id) => !targets.find((t) => t.id === id));  //查找哪些cameraId没有对应的meta
                return JSON.stringify({
                  success: false,
                  code: 'CAMERA_NOT_FOUND',
                  message: `CameraId(s) not found: ${missing.join(', ')}`,
                });
              }

              const buffers: Buffer[] = [];
              // 遍历有效摄像头ID，获取快照
              for (const { id } of targets) {
                const buf = await this.deviceManager.getCameraSnapshot(id);
                if (!buf || buf.length === 0) {
                  return JSON.stringify({
                    success: false,
                    code: 'CAMERA_OFFLINE',
                    message: `Camera ${id} is offline or snapshot unavailable.`,
                  });
                }
                buffers.push(buf);  //获取的有效快照添加到buffers数组中
              }
              // 调用拼图函数，生成拼接后的图像buffer
              const stitchedBuffer = await this.stitchCameraSnapshots(buffers, layout, outputFormat);
              // 将拼接后的图像buffer转换为base64字符串和dataUrl
              const base64 = stitchedBuffer.toString('base64');
              const mime = outputFormat === 'png' ? 'image/png' : 'image/jpeg';
              const dataUrl = `data:${mime};base64,${base64}`;
              const names = targets.map((t) => t.meta?.name ?? t.id).join(', ');
              const messageText = `Stitched ${cameraIds.length} camera snapshots (${names}) with layout ${layout}.`;

              // 返回包含拼接图像的JSON结果 
              return JSON.stringify({
                success: true,
                code: 'OK',
                cameraIds,
                layout,
                contentType: mime,
                data: base64,
                size: stitchedBuffer.length,
                message: messageText,
                openaiContent: [
                  { type: 'text', text: messageText },
                  {
                    type: 'image_url',
                    image_url: {
                      url: dataUrl,
                      detail: 'auto',
                    },
                  },
                ],
                langchainContent: [
                  { type: 'text', text: messageText },
                  { type: 'image_url', image_url: { url: dataUrl } },
                ],
                extra: {
                  intervalSeconds,
                },
              });
            } catch (e) {
              this.logger.error(`stitch_camera_images error: ${e instanceof Error ? e.message : e}`);
              return JSON.stringify({
                success: false,
                code: 'INTERNAL_ERROR',
                message: 'Error occurred while stitching camera snapshots.',
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
