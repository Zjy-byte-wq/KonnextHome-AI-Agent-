import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { StructuredToolInterface } from '@langchain/core/tools';
import { Language } from '@prisma/client';
import { DeviceManagerService } from '../../../device_manager/device_manager.service';
import { UserService } from '../../../user/user.service';
import { FloorProvider } from '../../../device_manager/floor/floor.provider';
import { LanguageService } from '../../../language/language.service';
import { LightToolProvider } from './light.tool.provider';
import { CurtainToolProvider } from './curtain.tool.provider';
import { AirconToolProvider } from './aircon.tool.provider';
import { FloorHeatingAndSwitchToolProvider } from './floor-heating-switch.tool.provider';
import { SceneToolProvider } from './scene.tool.provider';
import { MusicToolProvider } from './music.tool.provider';
import { CameraToolProvider } from './camera.tool.provider';

@Injectable()
export class ToolProvider {
  constructor(
    @InjectPinoLogger(ToolProvider.name)
    private readonly logger: PinoLogger,
    private readonly deviceManager: DeviceManagerService,
    private readonly userService: UserService,
    private readonly floorProvider: FloorProvider,
    private readonly languageService: LanguageService,
    private readonly lightToolProvider: LightToolProvider,
    private readonly curtainToolProvider: CurtainToolProvider,
    private readonly airconToolProvider: AirconToolProvider,
    private readonly floorHeatingAndSwitchToolProvider: FloorHeatingAndSwitchToolProvider,
    private readonly sceneToolProvider: SceneToolProvider,
    private readonly musicToolProvider: MusicToolProvider,
    private readonly cameraToolProvider: CameraToolProvider,
  ) { }

  /**
   * Generate floor/area context (non-device specific context)
   */
  private async genFloorAreaContext(language: Language): Promise<string> {
    try {
      const floors = await this.floorProvider.fetchFloorsAndAreas(language);

      if (!floors.length) return '';

      let text = '\n\n=== FLOOR & AREA STRUCTURE ===\nHere is the layout of your home:\n';
      for (const f of floors) {
        text += `\nFloor: ${f.floor}\n`;
        for (const a of f.area) text += `  - Area: ${a}\n`;
      }

      this.logger.info(`Generated floor area context (${text.length} chars)`);
      return text;
    } catch (err) {
      this.logger.warn('genFloorAreaContext error', err);
      return '';
    }
  }

  /**
   * Main entry: Generate all device contexts
   */
  async generateDeviceContext(userId: string): Promise<string> {
    try {
      let language = await this.languageService.getDefaultLanguage();
      try {
        const user = await this.userService.getUserByUsername(userId);
        language = user?.language;
      } catch (err) {
        this.logger.info('没找到数据库中对应用户，默认为maintainer');
      }

      const [lights, curtains, aircons, floorHeating, uniSwitches, floorAreaContext, sceneContext, musicPlayerContext, cameraContext] =
        await Promise.all([
          this.lightToolProvider.generateLightContext(language),
          this.curtainToolProvider.generateCurtainContext(language),
          this.airconToolProvider.generateAirconContext(language as Language),
          this.floorHeatingAndSwitchToolProvider.generateFloorHeatingContext(language as Language),
          this.floorHeatingAndSwitchToolProvider.generateUniSwitchContext(language as Language),
          this.genFloorAreaContext(language as Language),
          this.sceneToolProvider.generateSceneContext(language as Language),
          this.musicToolProvider.generateMusicPlayerContext(language as Language),
          this.cameraToolProvider.generateCameraContext(userId),
        ]);

      const deviceContext = [
        lights,
        curtains,
        aircons,
        floorHeating,
        uniSwitches,
        floorAreaContext,
        sceneContext,
        musicPlayerContext,
        cameraContext,
      ]
        .filter(Boolean)
        .join('\n');

      this.logger.info(`Generated device context for user ${userId}: ${deviceContext.length} characters`);
      return deviceContext;
    } catch (error) {
      this.logger.error(`Error generating device context for user ${userId}: ${error}`);
      return '';
    }
  }

  /**
   * Main entry: Generate all control tools
   */
  async generateControlTools(userId: string): Promise<StructuredToolInterface[]> {
    try {
      // Get user info and language setting
      let language = await this.languageService.getDefaultLanguage();
      try {
        const user = await this.userService.getUserByUsername(userId);
        language = user.language;
      } catch (err) {
        this.logger.info('数据库中无法找到对应用户，默认为maintainer');
      }

      // Collect all tools from different providers in parallel
      const [lightTools, curtainTools, airconTools, floorHeatingTools, sceneTools, musicTools, cameraTools] = await Promise.all([
        this.lightToolProvider.generateLightTools(userId, language),
        this.curtainToolProvider.generateCurtainTools(userId, language),
        this.airconToolProvider.generateAirconTools(userId, language),
        this.floorHeatingAndSwitchToolProvider.generateFloorHeatingAndSwitchTools(userId, language),
        this.sceneToolProvider.generateSceneTools(userId, language),
        this.musicToolProvider.generateMusicTools(userId, language),
        this.cameraToolProvider.generateCameraTools(userId, language as Language),
      ]);

      const tools = [
        ...lightTools,
        ...curtainTools,
        ...airconTools,
        ...floorHeatingTools,
        ...sceneTools,
        ...musicTools,
        ...cameraTools,
      ];

      this.logger.info('ToolProvider registered tools: ' + tools.map((t) => t.name).join(', '));

      return tools;
    } catch (error) {
      this.logger.error(`Error generating control tools: ${error}`);
      return [];
    }
  }

  /**
   * 2025/12/22改--新增家居控制工具
   */
  async generateHomeControlTools(userId: string): Promise<StructuredToolInterface[]> {
    try {
      let language = await this.languageService.getDefaultLanguage();
      try {
        const user = await this.userService.getUserByUsername(userId);
        language = user.language;
      } catch (err) {
        this.logger.info('数据库中无法找到对应用户，默认为maintainer');
      }

      const [lightTools, curtainTools, airconTools, floorHeatingTools, sceneTools, musicTools] = await Promise.all([
        this.lightToolProvider.generateLightTools(userId, language),
        this.curtainToolProvider.generateCurtainTools(userId, language),
        this.airconToolProvider.generateAirconTools(userId, language),
        this.floorHeatingAndSwitchToolProvider.generateFloorHeatingAndSwitchTools(userId, language),
        this.sceneToolProvider.generateSceneTools(userId, language),
        this.musicToolProvider.generateMusicTools(userId, language),
      ]);

      const tools = [
        ...lightTools,
        ...curtainTools,
        ...airconTools,
        ...floorHeatingTools,
        ...sceneTools,
        ...musicTools,
      ];

      this.logger.info('HomeControlTools registered: ' + tools.map((t) => t.name).join(', '));

      return tools;
    } catch (error) {
      this.logger.error(`Error generating home control tools: ${error}`);
      return [];
    }
  }

  /**
   * 2025/12/22改--新增摄像头相关工具
   */
  async generateVisionTools(userId: string): Promise<StructuredToolInterface[]> {
    try {
      let language = await this.languageService.getDefaultLanguage();
      try {
        const user = await this.userService.getUserByUsername(userId);
        language = user.language;
      } catch (err) {
        this.logger.info('数据库中无法找到对应用户，默认为maintainer');
      }

      const cameraTools = await this.cameraToolProvider.generateCameraTools(userId, language as Language);

      this.logger.info('VisionTools registered: ' + cameraTools.map((t) => t.name).join(', '));

      return cameraTools;
    } catch (error) {
      this.logger.error(`Error generating vision tools: ${error}`);
      return [];
    }
  }

  /**
   * Clear all tool description caches
   */
  clearToolDescriptionCache(): void {
    this.lightToolProvider.clearCache();
    this.curtainToolProvider.clearCache();
    this.airconToolProvider.clearCache();
    this.floorHeatingAndSwitchToolProvider.clearCache();
    this.sceneToolProvider.clearCache();
    this.musicToolProvider.clearCache();
    this.cameraToolProvider.clearCache();
    this.logger.info(`Cleared all tool description caches`);
  }

  /**
   * Clear tool description caches for a specific language
   */
  clearLanguageToolDescriptionCache(language: string): void {
    // Clear all caches since language-specific clearing requires coordination
    this.clearToolDescriptionCache();
    this.logger.info(`Cleared tool description cache entries for language: ${language}`);
  }
}
