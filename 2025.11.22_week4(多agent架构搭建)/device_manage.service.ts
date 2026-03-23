import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { MD5 } from 'crypto-js';
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AirconStationClusterType, Language, Name, AirconStation, FloorHeatingType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { HttpClientService } from 'src/http_client/http_client.service';
import { HomeLinkLocalAllData } from '../home_link/local/models/home_link_local_module.model';
import { Bootstrap } from '../utils/bootstrap';
import { EventLevelTwo_HomeLinkNative_Request } from '../event_manager/models/event_name.model';
import {
  HomeLinkAreaDeviceData,
  HomeLinkNativeAllData,
  HomeLinkNativeAllDataV2,
  HomeLinkNativeDeviceAndStatus,
  HomeLinkNativeRequestProcessed,
  HomeLinkNativeStaticConfig,
  HomeLinkNativeStatus,
  NameMap,
} from '../home_link/native/models/home_link_native_req_res.model';
import { EventManagerService } from '../event_manager/event_manager.service';
import { ResponseBodyData, ResponseMeta_IoTServer } from '../common/response.model';
import { UserService } from '../user/user.service';
import { PersonalisationService } from '../personalisation/personalisation.service';
import { LanguageService } from '../language/language.service';
import { ScheduleManagerService } from '../schedule_manager/schedule_manager.service';
import { CurtainProviderType } from './curtain/models/curtain_provider_type.model';
import { DeviceWithData } from './models/device_provider_data.model';
import { LightProviderType } from './light/models/light_provider_type.model';
import { CurtainProvider } from './curtain/curtain.provider';
import { LightProvider } from './light/light.provider';
import { CurtainDeviceWithData } from './curtain/models/curtain_device_with_data.model';
import { LightDeviceWithData } from './light/models/light_device_with_data.model';
import { AirconProvider } from './aircon/aircon.provider';
import { AirconStationDeviceWithData } from './aircon/aircon_station/models/aircon_station_device_with_data.model';
import { AirconDamperDeviceWithData } from './aircon/aircon_damper/models/aircon_damper_device_with_data.model';
import { MusicSystemPowerDeviceWithData } from './music/music_system_power/models/music_system_power_device_with_data.model';
import { MusicProvider } from './music/music.provider';
import { MusicSystemPowerProviderType } from './music/music_system_power/models/music_system_power_provider_type.model';
import { AreaProvider } from './area/area.provider';
import { CameraProvider } from './camera/camera.provider';
import { AccessControlProvider } from './access_control/access_control.provider';
import { NetworkProvider } from './network/network.provider';
import { NetworkSwitchDeviceWithData } from './network/network_switch/models/network_switch_device_with_data.model';
import { AccessControlProviderType } from './access_control/models/access_control_provider_type.model';
import { LiftCtrlEptProviderType } from './lift/liftCtrlEpt/models/liftCtrlEpt_provider_type.model';
import { SceneProvider } from './scene/scene.provider';
import { SceneDeviceWithData } from './scene/models/scene_device_with_data.model';
import { AlarmProvider } from './alarm/alarm.provider';
import { IRAlarmProviderType } from './alarm/ir_alarm/models/ir_alarm_provider_type.model';
import { IRAlarmDeviceWithData } from './alarm/ir_alarm/models/ir_alarm_device_with_data.model';
import { FloorHeatingProvider } from './floor_heating/floor_heating.provider';
import { FloorHeatingProviderType } from './floor_heating/models/floor_heating_provider_type.model';
import { UniSwitchProvider } from './uni_switch/uni_switch.provider';
import { UniSwitchProviderType } from './uni_switch/models/uni_switch_provider_type.model';
import { UniSwitchDeviceWithData } from './uni_switch/models/uni_switch_device_with_data.model';
import { HomeLinkNativeAllDataDto } from './dtos/home_link_native_all_data.dto';
import { AirconDamperProviderType } from './aircon/aircon_damper/models/aircon_damper_provider_type.model';
import { AirconStationProviderType } from './aircon/aircon_station/models/aircon_station_provider_type.model';
import { FloorProvider } from './floor/floor.provider';
import { IrrigationProvider } from './irrigation/irrigation.provider';
import { IrrigationProviderType } from './irrigation/models/irrigation_provider_type.model';
import { EnergyProvider } from './energy/energy.provider';
import { AccessControlDeviceWithData } from './access_control/models/access_control_device_with_data.model';
import { RemoteProvider } from './remote/remote.provider';
import { MatrixProvider } from './matrix/matrix.provider';
import {
  ChatbotAirconStationCommandDto,
  ChatbotAirconStationMetadataDto,
  ChatbotAirconStationPropertyDto,
  ChatbotValidateAirconOnOffCommandDto,
} from './aircon/aircon_station/models/chatbot_aircon_station.model';
import {
  ChatbotDefaultFloorHeatingCommand,
  ChatbotFhPropertyDto,
  ChatbotFloorHeatingMetadata,
  ChatbotSimpleFloorHeatingCommand,
} from './floor_heating/models/chatbot_floor_heating_type.model';
import {
  ChatbotCurtainCommandDto,
  ChatbotCurtainMetadataDto,
  ChatbotCurtainPropertyDto,
} from './curtain/models/chatbot_curtain.model';
import { ChatbotLightMetadataDto, ChatbotLightPropertyDto, ChatbotLightCommandDto } from './light/models/chatbot_light.model';
import { LiftCtrlEptProvider } from './lift/liftCtrlEpt/liftCtrlEpt.provider';
import { LiftCtrlEptDeviceWithData } from './lift/liftCtrlEpt/models/liftCtrlEpt_device_with_data.model';
import { TriggerSceneDto } from './scene/dtos/trigger_scene.dto';
import { ChatbotBuildSceneBySnapshotInputData, ChatbotSceneMetaData } from './scene/dtos/chatbot_scene.dto';
import { ChatbotMusicPlayerInfo } from './music/music_player/models/chatbot_music.model';
import { MusicPlayerControlCommand } from './music/music_player/models/music_player_control_command.model';
import { LiftProvider } from './lift/lift.provider';
import { ChatbotActionType, ChatbotEditSceneActionContent } from '../integrations/chatbot/models/chatbot_action.dto';
import { HomeLinkNativeControlUpdateTarget } from '../home_link/native/models/home_link_native_ctrl_update.model';
import { ChatbotCameraMetadataDto } from './camera/models/chatbot_camera.model';

@Injectable()
export class DeviceManagerService implements Bootstrap {
  constructor(
    @InjectPinoLogger(DeviceManagerService.name)
    private readonly logger: PinoLogger,
    private readonly eventManagerService: EventManagerService,
    private readonly userService: UserService,
    private readonly floorProvider: FloorProvider,
    private readonly areaProvider: AreaProvider,
    private readonly lightProvider: LightProvider,
    private readonly curtainProvider: CurtainProvider,
    private readonly airconProvider: AirconProvider,
    private readonly musicProvider: MusicProvider,
    private readonly matrixProvider: MatrixProvider,
    private readonly cameraProvider: CameraProvider,
    private readonly accessControlProvider: AccessControlProvider,
    private readonly liftProvider: LiftProvider,
    private readonly liftCtrlEptProvider: LiftCtrlEptProvider,
    private readonly networkProvider: NetworkProvider,
    private readonly sceneProvider: SceneProvider,
    private readonly alarmProvider: AlarmProvider,
    private readonly floorHeatingProvider: FloorHeatingProvider,
    private readonly uniSwitchProvider: UniSwitchProvider,
    private readonly irrigationProvider: IrrigationProvider,
    private readonly personalisationService: PersonalisationService,
    private readonly languageService: LanguageService,
    private readonly scheduleManagerService: ScheduleManagerService,
    private readonly energyProvider: EnergyProvider,
    private readonly remoteProvider: RemoteProvider,
    private readonly httpClientService: HttpClientService,
    private readonly prismaService: PrismaService,
  ) { }

  async bootstrap(): Promise<boolean> {
    try {
      this.logger.info('Device manager loading');
      await this.lightProvider.loadLights();
      await this.curtainProvider.loadCurtains();
      await this.airconProvider.loadAirconSystem();
      await this.musicProvider.loadMusicSystem();
      if (!process.env.deviceModuleNotLoad) {
        this.logger.debug(`deviceModuleNotLoad  camera don't load`);
        await this.cameraProvider.loadCameras();
      }
      await this.accessControlProvider.loadAccessControls();
      await this.liftCtrlEptProvider.loadLiftCtrlEpts();
      await this.alarmProvider.loadAlarm();
      await this.floorHeatingProvider.loadFloorHeatings();
      await this.uniSwitchProvider.loadUniSwitches();
      await this.irrigationProvider.loadIrrigations();
      await this.energyProvider.loadEnergy();
      await this.remoteProvider.loadRemotes();
      await this.musicProvider.bootstrap();
      this.logger.info('Device manager loaded');

      return true;
    } catch (err) {
      this.logger.fatal(err);

      return false;
    }
  }

  @OnEvent(EventLevelTwo_HomeLinkNative_Request.ALL_DATA)
  async handleHomeLinkNative_ALL_DATA(processedRequest: HomeLinkNativeRequestProcessed): Promise<void> {
    const result = await this.eventManagerService.processHomeLinkNativeRequestPayload(
      processedRequest,
      HomeLinkNativeAllDataDto,
    );
    if (!result) return;
    const { responseBase } = result;

    try {
      this.eventManagerService.emitHomeLinkNativeResponse(
        result.responseBase,
        ResponseMeta_IoTServer.T_20000,
        await this.getHomeLinkNativeAllData(responseBase.userId),
      );
      this.logger.debug(`Fetched all data`);
    } catch (err) {
      this.logger.error(err);
      this.eventManagerService.emitHomeLinkNativeResponse<ResponseBodyData>(
        responseBase,
        ResponseMeta_IoTServer.T_50000,
        ResponseBodyData.NULL,
      );
    }
  }

  /**
   * warning: 此功能需要重新设计
   *
   * @param id
   */
  triggerCurtainStop(id: string): void {
    this.curtainProvider.triggerCurtainStop(id);
  }

  async getSnapshot(id: string): Promise<Buffer> {
    return await this.cameraProvider.getSnapshot(id);
  }

  triggerAccessControlToggle(id: string): void {
    this.accessControlProvider.triggerAccessControlToggle(id);
  }

  triggerLiftCtrlEpt(id: string): void {
    this.liftCtrlEptProvider.triggerLiftCtrlEptToggle(id);
  }

  triggerNetworkSwitch(id: string): void {
    this.networkProvider.triggerNetworkSwitch(id);
  }

  triggerScene(dto: TriggerSceneDto): void {
    this.sceneProvider.triggerScene(dto);
  }

  triggerRemoteButton(id: string): void {
    this.remoteProvider.triggerRemoteButton(id);
  }

  async getHomeLinkLocalAllData(): Promise<HomeLinkLocalAllData> {
    const [area, light, curtain, music, aircon, camera, accessControl, network, scene, alarm, floorHeating, uniSwitch] =
      await Promise.all([
        this.areaProvider.getAreaHomeLinkLocal(),
        this.lightProvider.getLightHomeLinkLocal(),
        this.curtainProvider.getCurtainHomeLinkLocal(),
        this.musicProvider.getMusicHomeLinkLocal(),
        this.airconProvider.getAirconHomeLinkLocal(),
        this.cameraProvider.getCameraHomeLinkLocal(),
        this.accessControlProvider.getAccessControlHomeLinkLocal(),
        this.networkProvider.getNetworkHomeLinkLocal(),
        this.sceneProvider.getSceneHomeLinkLocal(),
        this.alarmProvider.getAlarmHomeLinkLocal(),
        this.floorHeatingProvider.getFloorHeatingHomeLinkLocal(),
        this.uniSwitchProvider.getUniSwitchHomeLinkLocal(),
      ]);

    return {
      area,
      light,
      curtain,
      music,
      aircon,
      camera,
      accessControl,
      network,
      scene,
      alarm,
      floorHeating,
      uniSwitch,
    };
  }

  async getHomeLinkNativeDataByArea(): Promise<HomeLinkAreaDeviceData> {
    const userTypeWithPermission = await this.userService.getDeviceUserInfo();
    const { language } = userTypeWithPermission;
    const [languageSetting, floor, area, scene, light, curtain, aircon, floorHeating, uniSwitch] = await Promise.all([
      this.languageService.fetchLanguageSetting({ all: true }),
      this.floorProvider.getFloorHomeLinkNative(userTypeWithPermission),
      this.areaProvider.getAreaHomeLinkNative(userTypeWithPermission, null),
      this.sceneProvider.fetchSceneHomeLinkNativeLocalDevice({ all: true }),
      // this.sceneProvider.fetchSceneHomeLinkNative({ all: true }, userTypeWithPermission.id),
      this.lightProvider.getLightHomeLinkNative(userTypeWithPermission),
      this.curtainProvider.getCurtainHomeLinkNative(userTypeWithPermission),
      this.airconProvider.getAirconHomeLinkNative(userTypeWithPermission),
      this.floorHeatingProvider.getFloorHeatingHomeLinkNative(userTypeWithPermission),
      this.uniSwitchProvider.getUniSwitchHomeLinkNative(userTypeWithPermission),
    ]);

    return {
      languageSetting,
      language,
      floor,
      area,
      scene,
      light,
      curtain,
      aircon,
      floorHeating,
      uniSwitch,
    };
  }

  async getHomeLinkNativeDataV2(userId: string): Promise<HomeLinkNativeAllDataV2> {
    const userTypeWithPermission = await this.userService.getUserInfo(userId);
    const { language, userType, userPermission } = userTypeWithPermission;
    this.logger.info(`$$$$$$$$$$$$ 总包 开始  查询  $$$$$$$$$$$$ `);
    const [
      matrix,
      personalisation,
      user,
      languageSetting,
      // schedule,
      floor,
      area,
      light,
      curtain,
      music,
      aircon,
      camera,
      accessControl,
      lift,
      network,
      scene,
      alarm,
      floorHeating,
      uniSwitch,
      irrigation,
      energy,
      remote,
    ] = await Promise.all([
      this.matrixProvider.getMatrixHomeLinkNative(userTypeWithPermission),
      this.personalisationService.getPersonalisationHomeLinkNative(),
      this.userService.fetchUser({ all: true }, userId),
      this.languageService.fetchLanguageSetting({ all: true }),
      // this.scheduleManagerService.fetchSchedule({ all: true }, userId),
      this.floorProvider.getFloorHomeLinkNative(userTypeWithPermission),
      this.areaProvider.getAreaHomeLinkNative(userTypeWithPermission, userId),
      this.lightProvider.getLightHomeLinkNative(userTypeWithPermission),
      this.curtainProvider.getCurtainHomeLinkNative(userTypeWithPermission),
      this.musicProvider.getMusicHomeLinkNative(userTypeWithPermission),
      this.airconProvider.getAirconHomeLinkNative(userTypeWithPermission),
      this.cameraProvider.getCameraHomeLinkNative(userTypeWithPermission),
      this.accessControlProvider.getAccessControlHomeLinkNative(userTypeWithPermission),
      this.liftProvider.getLiftHomeLinkNative(userTypeWithPermission),
      this.networkProvider.getNetworkHomeLinkNative(userTypeWithPermission),
      this.sceneProvider.fetchSceneHomeLinkNative({ all: true }, userId),
      this.alarmProvider.getAlarmHomeLinkNative(userTypeWithPermission),
      this.floorHeatingProvider.getFloorHeatingHomeLinkNative(userTypeWithPermission),
      this.uniSwitchProvider.getUniSwitchHomeLinkNative(userTypeWithPermission),
      this.irrigationProvider.getIrrigationHomeLinkNative(userTypeWithPermission),
      this.energyProvider.getEnergyHomeLinkNative(userTypeWithPermission),
      this.remoteProvider.getRemoteHomeLinkNative(userTypeWithPermission),
    ]);
    this.logger.info(`$$$$$$$$$$$$ 总包 结束 查询  $$$$$$$$$$$$ `);
    return {
      matrix,
      personalisation,
      user,
      schedule: [],
      languageSetting,
      language,
      userType,
      userPermission,
      floor,
      area,
      light,
      curtain,
      lift,
      music,
      aircon,
      camera,
      accessControl,
      network,
      scene,
      alarm,
      floorHeating,
      uniSwitch,
      irrigation,
      energy,
      remote,
    };
  }

  /**
   * 根据用户权限，获取静态 + 状态数据总包
   * @param userId
   * @returns
   */
  async getHomeLinkNativeDeviceAndStatus(userId: string): Promise<HomeLinkNativeDeviceAndStatus> {
    const userTypeWithPermission = await this.userService.getUserInfo(userId);
    const { language, userType, userPermission } = userTypeWithPermission;
    const [
      lift,
      matrix,
      languageSetting,
      floor,
      area,
      light,
      curtain,
      music,
      aircon,
      camera,
      accessControl,
      network,
      scene,
      alarm,
      floorHeating,
      uniSwitch,
      irrigation,
      energy,
      remote,
    ] = await Promise.all([
      this.liftProvider.getLiftHomeLinkNative(userTypeWithPermission),
      this.matrixProvider.getMatrixHomeLinkNative(userTypeWithPermission),
      this.languageService.fetchLanguageSetting({ all: true }),
      this.floorProvider.getFloorHomeLinkNative(userTypeWithPermission),
      this.areaProvider.getAreaHomeLinkNative(userTypeWithPermission, userId),
      this.lightProvider.getLightHomeLinkNative(userTypeWithPermission),
      this.curtainProvider.getCurtainHomeLinkNative(userTypeWithPermission),
      this.musicProvider.getMusicHomeLinkNative(userTypeWithPermission),
      this.airconProvider.getAirconHomeLinkNative(userTypeWithPermission),
      this.cameraProvider.getCameraHomeLinkNative(userTypeWithPermission),
      this.accessControlProvider.getAccessControlHomeLinkNative(userTypeWithPermission),
      this.networkProvider.getNetworkHomeLinkNative(userTypeWithPermission),
      this.sceneProvider.fetchSceneList(userId),
      this.alarmProvider.getAlarmHomeLinkNative(userTypeWithPermission),
      this.floorHeatingProvider.getFloorHeatingHomeLinkNative(userTypeWithPermission),
      this.uniSwitchProvider.getUniSwitchHomeLinkNative(userTypeWithPermission),
      this.irrigationProvider.getIrrigationHomeLinkNative(userTypeWithPermission),
      this.energyProvider.getEnergyHomeLinkNative(userTypeWithPermission),
      this.remoteProvider.getRemoteHomeLinkNative(userTypeWithPermission),
    ]);

    return {
      matrix,
      languageSetting,
      language,
      userType,
      userPermission,
      floor,
      area,
      light,
      curtain,
      music,
      aircon,
      camera,
      accessControl,
      lift,
      network,
      scene,
      alarm,
      floorHeating,
      uniSwitch,
      irrigation,
      energy,
      remote,
    };
  }

  async getAllDevicesStatus(userId: string) {
    const userTypeWithPermission = await this.userService.getUserInfo(userId);
    const [
      scene,
      matrix,
      light,
      curtain,
      music,
      aircon,
      camera,
      accessControl,
      liftCtrlEpt,
      network,
      alarm,
      floorHeating,
      uniSwitch,
      irrigation,
      energy,
      remote,
    ] = await Promise.all([
      this.sceneProvider.fetchSceneList(userId),
      this.matrixProvider.getMatrixHomeLinkNative(userTypeWithPermission),
      this.lightProvider.getLightHomeLinkNative(userTypeWithPermission),
      this.curtainProvider.getCurtainHomeLinkNative(userTypeWithPermission),
      this.musicProvider.getMusicHomeLinkNative(userTypeWithPermission),
      this.airconProvider.getAirconHomeLinkNative(userTypeWithPermission),
      this.cameraProvider.getCameraHomeLinkNative(userTypeWithPermission),
      this.accessControlProvider.getAccessControlHomeLinkNative(userTypeWithPermission),
      this.liftCtrlEptProvider.getLiftCtrlEptHomeLinkNative(userTypeWithPermission),
      this.networkProvider.getNetworkHomeLinkNative(userTypeWithPermission),
      this.alarmProvider.getAlarmHomeLinkNative(userTypeWithPermission),
      this.floorHeatingProvider.getFloorHeatingHomeLinkNative(userTypeWithPermission),
      this.uniSwitchProvider.getUniSwitchHomeLinkNative(userTypeWithPermission),
      this.irrigationProvider.getIrrigationHomeLinkNative(userTypeWithPermission),
      this.energyProvider.getEnergyHomeLinkNative(userTypeWithPermission),
      this.remoteProvider.getRemoteHomeLinkNative(userTypeWithPermission),
    ]);

    const _matrix = matrix.map(({ id, providerType, ioType, brand, MatrixInput, MatrixOutput }) => ({
      id,
      providerType,
      ioType,
      brand,
      MatrixInput,
      MatrixOutput,
    }));

    const _curtain = curtain.map(
      ({ id, hasStop, hasPosition, controlMethod, travelTime, currentPosition, targetPosition }) => ({
        id,
        hasStop,
        hasPosition,
        controlMethod,
        travelTime,
        currentPosition,
        targetPosition,
      }),
    );

    const _camera = camera.map(({ id, power }) => ({ id, power }));

    const _light = light.map(({ id, dimmable, cct, on, brightness, temperature, rgb, color }) => ({
      id,
      dimmable,
      cct,
      on,
      brightness,
      temperature,
      rgb,
      color,
    }));

    const _floorHeating = floorHeating.map(
      ({ id, on, valveStatus, setTemp, envTemp, simpleStopMin, simpleStartMin }) => ({
        id,
        on,
        valveStatus,
        setTemp,
        envTemp,
        simpleStopMin,
        simpleStartMin,
      }),
    );

    const _uniSwitch = uniSwitch.map(({ id, type, on, homeSyncId }) => ({
      id,
      type,
      on,
      homeSyncId,
    }));

    return {
      matrix: _matrix,
      light: _light,
      curtain: _curtain,
      language: userTypeWithPermission.language,
      music,
      aircon,
      camera: _camera,
      accessControl,
      liftCtrlEpt,
      network,
      scene,
      alarm,
      floorHeating: _floorHeating,
      uniSwitch: _uniSwitch,
      irrigation,
      energy,
      remote,
    };
  }

  async getStaticConfigFetch(userId: string): Promise<HomeLinkNativeStaticConfig> {
    const userTypeWithPermission = await this.userService.getUserInfo(userId);
    const { language, userType, userPermission } = userTypeWithPermission;
    const [area, floor, lift] = await Promise.all([
      this.areaProvider.getAreaHomeLinkNative(userTypeWithPermission, userId),
      this.floorProvider.getFloorHomeLinkNative(userTypeWithPermission),
      this.liftProvider.getLiftHomeLinkNative(userTypeWithPermission),
    ]);
    return {
      area,
      floor,
      userType,
      userPermission,
      lift,
    };
  }

  async fetchNames(): Promise<NameMap> {
    const res = await this.prismaService.name.findMany();
    const obj: NameMap = {};
    for (const n of res) {
      obj[n.id] = n;
    }
    return obj;
  }

  async getAllDevicesStatusMd5(userId: string) {
    const data = await this.getAllDevicesStatus(userId);
    const result = {};
    for (const key of Object.keys(data)) {
      result[key] = MD5(data[key]).toString();
    }
    return result;
  }

  /**
   * 生成总包数据并上传至online
   * @param key 上传某一类设备，不传就上传全部
   * @returns
   */
  async generateDevicesDataUpload(key?: string) {
    try {
      const data: any = {};

      const fnMap = {
        matrix: () => this.matrixProvider.onlineGetMatrixHomeLinkNative(),
        // schedule: () => this.languageService.fetchLanguageSetting({ all: true }),
        schedule: () => [],
        languageSetting: () => this.scheduleManagerService.onlineGetchSchedule({ all: true }),
        floor: () => this.floorProvider.onlineGetFloorHomeLinkNative(),
        area: () => this.areaProvider.onlineGetAreaHomeLinkNative(),
        light: () => this.lightProvider.onlineGetLightHomeLinkNative(),
        curtain: () => this.curtainProvider.onlineGetCurtainHomeLinkNative(),
        music: () => this.musicProvider.onlineGetMusicHomeLinkNative(),
        aircon: () => this.airconProvider.onlineGetAirconHomeLinkNative(),
        camera: () => this.cameraProvider.onlineGetCameraHomeLinkNative(),
        accessControl: () => this.accessControlProvider.onlineGetAccessControlHomeLinkNative(),
        liftCtrlEpt: () => this.liftCtrlEptProvider.onlineGetLiftCtrlEptHomeLinkNative(),
        network: () => this.networkProvider.onlineGetNetworkHomeLinkNative(),
        alarm: () => this.alarmProvider.onlineGetAlarmHomeLinkNative(),
        floorHeating: () => this.floorHeatingProvider.onlineGetFloorHeatingHomeLinkNative(),
        uniSwitch: () => this.uniSwitchProvider.onlineGetUniSwitchHomeLinkNative(),
        irrigation: () => this.irrigationProvider.onlineGetIrrigationHomeLinkNative(),
        energy: () => this.energyProvider.onlineGetEnergyHomeLinkNative(),
        remote: () => this.remoteProvider.onlineGetRemoteHomeLinkNative(),
        lift: () => this.liftProvider.onlineGetLiftHomeLinkNative(),
      };

      if (!key) {
        const [
          matrix,
          languageSetting,
          floor,
          area,
          light,
          curtain,
          music,
          aircon,
          camera,
          accessControl,
          lift,
          network,
          alarm,
          floorHeating,
          uniSwitch,
          irrigation,
          energy,
          remote,
        ] = await Promise.all([
          this.matrixProvider.onlineGetMatrixHomeLinkNative(),
          this.languageService.fetchLanguageSetting({ all: true }),
          this.floorProvider.onlineGetFloorHomeLinkNative(),
          this.areaProvider.onlineGetAreaHomeLinkNative(),
          this.lightProvider.onlineGetLightHomeLinkNative(),
          this.curtainProvider.onlineGetCurtainHomeLinkNative(),
          this.musicProvider.onlineGetMusicHomeLinkNative(),
          this.airconProvider.onlineGetAirconHomeLinkNative(),
          this.cameraProvider.onlineGetCameraHomeLinkNative(),
          this.accessControlProvider.onlineGetAccessControlHomeLinkNative(),
          this.liftProvider.onlineGetLiftHomeLinkNative(),
          this.networkProvider.onlineGetNetworkHomeLinkNative(),
          this.alarmProvider.onlineGetAlarmHomeLinkNative(),
          this.floorHeatingProvider.onlineGetFloorHeatingHomeLinkNative(),
          this.uniSwitchProvider.onlineGetUniSwitchHomeLinkNative(),
          this.irrigationProvider.onlineGetIrrigationHomeLinkNative(),
          this.energyProvider.onlineGetEnergyHomeLinkNative(),
          this.remoteProvider.onlineGetRemoteHomeLinkNative(),
        ]);
        data.matrix = matrix;
        // data.schedule = schedule;
        data.schedule = [];
        data.languageSetting = languageSetting;
        data.floor = floor;
        data.area = area;
        data.light = light;
        data.curtain = curtain;
        data.music = music;
        data.aircon = aircon;
        data.camera = camera;
        data.accessControl = accessControl;
        data.lift = lift;
        data.network = network;
        data.alarm = alarm;
        data.floorHeating = floorHeating;
        data.uniSwitch = uniSwitch;
        data.irrigation = irrigation;
        data.energy = energy;
        data.remote = remote;
      } else {
        const fn = fnMap[key];
        if (!fn) {
          this.logger.error('key 不对，不能往下备份');
          return;
        }
        data[key] = await fn();
      }
      await this.httpClientService.konnextonlinePost(
        '/edgeLocalDevice/uploadDevice',
        {
          data: data,
        },
        true,
      );
      // this.logger.info('Devices 数据同步成功');
    } catch (error: any) {
      this.logger.error('Devices 数据同步失败', error.message);
      this.logger.error(error);
    }
  }

  async generateUserDataUpload() {
    try {
      const users = await this.userService.onlineFetchUser();
      await this.httpClientService.konnextonlinePost(
        '/edgeLocalDevice/uploadUser',
        {
          data: users,
        },
        true,
      );
      // this.logger.info('User 数据同步成功');
    } catch (error: any) {
      this.logger.error('User 数据同步失败', error.message);
      this.logger.error(error);
    }
  }
  async generateSceneDataUpload() {
    try {
      const scene = await this.sceneProvider.onlineFetchSceneHomeLinkNative({ all: true });
      await this.httpClientService.konnextonlinePost(
        '/edgeLocalDevice/uploadScene',
        {
          data: scene,
        },
        true,
      );
      // this.logger.info('scene 数据同步成功');
    } catch (error: any) {
      this.logger.error('scene 数据同步失败', error.message);
      this.logger.error(error);
    }
  }

  async getHomeLinkNativeAllData(currentUserId: string): Promise<HomeLinkNativeAllData> {
    const userTypeWithPermission = await this.userService.getUserInfo(currentUserId);
    const { language, userType, userPermission } = userTypeWithPermission;
    const [
      personalisation,
      floor,
      area,
      light,
      curtain,
      music,
      aircon,
      camera,
      accessControl,
      liftCtrlEpt,
      network,
      scene,
      alarm,
      floorHeating,
      uniSwitch,
      irrigation,
    ] = await Promise.all([
      this.personalisationService.getPersonalisationHomeLinkNative(),
      this.floorProvider.getFloorHomeLinkNative(userTypeWithPermission),
      this.areaProvider.getAreaHomeLinkNative(userTypeWithPermission, currentUserId),
      this.lightProvider.getLightHomeLinkNative(userTypeWithPermission),
      this.curtainProvider.getCurtainHomeLinkNative(userTypeWithPermission),
      this.musicProvider.getMusicHomeLinkNative(userTypeWithPermission),
      this.airconProvider.getAirconHomeLinkNative(userTypeWithPermission),
      this.cameraProvider.getCameraHomeLinkNative(userTypeWithPermission),
      this.accessControlProvider.getAccessControlHomeLinkNative(userTypeWithPermission),
      this.liftCtrlEptProvider.getLiftCtrlEptHomeLinkNative(userTypeWithPermission),
      this.networkProvider.getNetworkHomeLinkNative(userTypeWithPermission),
      this.sceneProvider.getSceneHomeLinkNative(userTypeWithPermission),
      this.alarmProvider.getAlarmHomeLinkNative(userTypeWithPermission),
      this.floorHeatingProvider.getFloorHeatingHomeLinkNative(userTypeWithPermission),
      this.uniSwitchProvider.getUniSwitchHomeLinkNative(userTypeWithPermission),
      this.irrigationProvider.getIrrigationHomeLinkNative(userTypeWithPermission),
    ]);

    return {
      personalisation,
      language,
      userType,
      userPermission,
      floor,
      area,
      light,
      curtain,
      music,
      aircon,
      camera,
      accessControl,
      liftCtrlEpt,
      network,
      scene,
      alarm,
      floorHeating,
      uniSwitch,
      irrigation,
    };
  }

  getLightProviderType(id: string): LightProviderType | undefined {
    return this.lightProvider.getLightProviderType(id);
  }

  getLightDimmable(id: string): boolean | undefined {
    return this.lightProvider.getLightDimmable(id);
  }

  getCurtainProviderType(id: string): CurtainProviderType | undefined {
    return this.curtainProvider.getCurtainProviderType(id);
  }

  getAirconStationProviderType(id: string): AirconStationProviderType | undefined {
    return this.airconProvider.getAirconStationProviderType(id);
  }

  getAirconDamperProviderType(id: string): AirconDamperProviderType | undefined {
    return this.airconProvider.getAirconDamperProviderType(id);
  }

  getMusicSystemPowerProviderType(id: string): MusicSystemPowerProviderType | undefined {
    return this.musicProvider.getMusicSystemPowerProviderType(id);
  }

  getAccessControlProviderType(id: string): AccessControlProviderType | undefined {
    return this.accessControlProvider.getAccessControlProviderType(id);
  }

  getLiftCtrlEptProviderType(id: string): LiftCtrlEptProviderType | undefined {
    return this.liftCtrlEptProvider.getLiftCtrlEptProviderType(id);
  }

  getIRAlarmProviderType(id: string): IRAlarmProviderType | undefined {
    return this.alarmProvider.getIRAlarmProviderType(id);
  }

  getFloorHeatingProviderType(id: string): FloorHeatingProviderType | undefined {
    return this.floorHeatingProvider.getFloorHeatingProviderType(id);
  }

  getUniSwitchProviderType(id: string): UniSwitchProviderType | undefined {
    return this.uniSwitchProvider.getUniSwitchProviderType(id);
  }

  getIrrigationProviderType(id: string): IrrigationProviderType | undefined {
    return this.irrigationProvider.getIrrigationProviderType(id);
  }

  async getLightsArea(ids: string[]): Promise<string[]> {
    return await this.lightProvider.getLightsArea(ids);
  }

  async getCurtainsArea(ids: string[]): Promise<string[]> {
    return await this.curtainProvider.getCurtainsArea(ids);
  }

  async getAirconDampersArea(ids: string[]): Promise<string[]> {
    return await this.airconProvider.getAirconDampersArea(ids);
  }

  async getAirconOpenDamperByClusterId(clusterId: string) {
    return await this.airconProvider.getAirconOpenDamperByClusterId(clusterId);
  }

  async getAirconStationDeviceByClusterId(id: string): Promise<AirconStation> {
    return await this.airconProvider.getAirconStationDeviceByClusterId(id);
  }

  async getFloorHeatingsArea(ids: string[]): Promise<string[]> {
    return await this.floorHeatingProvider.getFloorHeatingsArea(ids);
  }

  async getUniSwitchesArea(ids: string[]): Promise<string[]> {
    return await this.uniSwitchProvider.getUniSwitchesArea(ids);
  }

  async getDevicesWithData(): Promise<DeviceWithData[]> {
    return [
      ...(await this.getLightDevicesWithData()),
      ...(await this.getCurtainDevicesWithData()),
      ...(await this.getAirconStationDevicesWithData()),
      ...(await this.getAirconDamperDevicesWithData()),
      ...(await this.getMusicSystemPowerDevicesWithData()),
      ...(await this.getNetworkSwitchDevicesWithData()),
      ...(await this.getSceneDevicesWithData()),
      ...(await this.getIRAlarmDevicesWithData()),
      ...(await this.getUniSwitchDevicesWithData()),
      ...(await this.getAccessControlDevicesWithData()),
      ...(await this.getLiftCtrlEptDevicesWithData()),
    ];
  }

  async getLightDevicesWithData(): Promise<LightDeviceWithData[]> {
    return await this.lightProvider.getLightDevicesWithData();
  }

  async getCurtainDevicesWithData(): Promise<CurtainDeviceWithData[]> {
    return await this.curtainProvider.getCurtainDevicesWithData();
  }

  async getAirconStationDevicesWithData(): Promise<AirconStationDeviceWithData[]> {
    return await this.airconProvider.getAirconStationDevicesWithData();
  }

  async getAirconDamperDevicesWithData(): Promise<AirconDamperDeviceWithData[]> {
    return await this.airconProvider.getAirconDamperDevicesWithData();
  }

  private async getMusicSystemPowerDevicesWithData(): Promise<MusicSystemPowerDeviceWithData[]> {
    return await this.musicProvider.getMusicSystemPowerDevicesWithData();
  }

  private async getNetworkSwitchDevicesWithData(): Promise<NetworkSwitchDeviceWithData[]> {
    return await this.networkProvider.getNetworkSwitchDevicesWithData();
  }

  private async getSceneDevicesWithData(): Promise<SceneDeviceWithData[]> {
    return await this.sceneProvider.getSceneDevicesWithData();
  }

  private async getIRAlarmDevicesWithData(): Promise<IRAlarmDeviceWithData[]> {
    return await this.alarmProvider.getIRAlarmDevicesWithData();
  }

  async getUniSwitchDevicesWithData(): Promise<UniSwitchDeviceWithData[]> {
    return await this.uniSwitchProvider.getUniSwitchDevicesWithData();
  }

  private async getAccessControlDevicesWithData(): Promise<AccessControlDeviceWithData[]> {
    return await this.accessControlProvider.getAccessControlDevicesWithData();
  }

  private async getLiftCtrlEptDevicesWithData(): Promise<LiftCtrlEptDeviceWithData[]> {
    return await this.liftCtrlEptProvider.getLiftCtrlEptDevicesWithData();
  }

  async getLightByAreas(areas: string[]): Promise<LightDeviceWithData[]> {
    return await this.lightProvider.getLightDevicesByAreas(areas);
  }

  async getCurtainByAreas(areas: string[]): Promise<CurtainDeviceWithData[]> {
    return await this.curtainProvider.getCurtainDevicesByAreas(areas);
  }

  async getAirconStationByAreas(areas: string[]): Promise<AirconStationDeviceWithData[]> {
    return await this.airconProvider.getAirconStationByAreas(areas);
  }

  /**
   * AI/chatbot related methods
   */

  // AI - Aircon
  async getChatbotAirconStationMetaData(lan: Language): Promise<ChatbotAirconStationMetadataDto[]> {
    const stations = await this.airconProvider.getChatbotAirconStationData(lan);
    return stations;
  }

  async getChatbotAirconStationPropertyData(stationId: string): Promise<ChatbotAirconStationPropertyDto> {
    return await this.airconProvider.getChatbotAirconStationPropertyData(stationId);
  }

  async sendChatbotAirconControlCommand(command: ChatbotAirconStationCommandDto) {
    await this.airconProvider.sendChatbotAirconControlCommand(command);
  }

  // AI - Curtain
  async getChatbotCurtainMetaData(lan: Language): Promise<ChatbotCurtainMetadataDto[]> {
    const curtains = await this.curtainProvider.getChatbotCurtainMetaData(lan);
    return curtains;
  }

  async getChatbotCurtainPropertyData(curtainId: string): Promise<ChatbotCurtainPropertyDto> {
    return await this.curtainProvider.getChatbotCurtainPropertyData(curtainId);
  }

  async sendChatbotCurtainCommand(command: ChatbotCurtainCommandDto): Promise<void> {
    await this.curtainProvider.sendChatbotCurtainCommand(command);
  }

  // AI - Lights
  async getChatbotLightMetaData(lan: Language): Promise<ChatbotLightMetadataDto[]> {
    const lights = await this.lightProvider.getChatbotLightMetadata(lan);
    return lights;
  }

  async getChatbotLightPropertyData(id: string): Promise<ChatbotLightPropertyDto> {
    return await this.lightProvider.getChatbotLightProperty(id);
  }

  async sendChatbotLightCommand(command: ChatbotLightCommandDto): Promise<void> {
    await this.lightProvider.sendChatbotLightCommand(command);
  }

  // AI - Floor Heating
  async getChatbotFloorHeatingMetaData(language: Language): Promise<ChatbotFloorHeatingMetadata[]> {
    return await this.floorHeatingProvider.getChatbotFloorHeatingMetaData(language);
  }

  async getChatbotFloorHeatingPropertyData(id: string): Promise<ChatbotFhPropertyDto> {
    return await this.floorHeatingProvider.getChatbotFloorHeatingPropertyData(id);
  }

  async sendChatbotFloorHeatingSimpleCommand(command: ChatbotSimpleFloorHeatingCommand): Promise<void> {
    await this.floorHeatingProvider.sendChatbotSimpleFhCommand(command);
  }

  async sendChatbotFloorHeatingDefaultCommand(command: ChatbotDefaultFloorHeatingCommand): Promise<void> {
    await this.floorHeatingProvider.sendChatbotDefaultFhCommand(command);
  }

  // AI - Scene
  async getSceneMetaData(language: Language): Promise<ChatbotSceneMetaData[]> {
    return await this.sceneProvider.getChatbotSceneMetaData(language);
  }

  async triggerAiScene(id: string): Promise<void> {
    await this.triggerScene({ id });
  }

  // AI - Action
  async sendChatbotEditSceneAction(sceneId: string): Promise<void> {
    if (!sceneId) {
      throw Error('sceneId is required for ai create scene');
    }
    this.eventManagerService.emitHomeLinkNativeUpdate({
      target: HomeLinkNativeControlUpdateTarget.CHATBOT,
      payload: [
        {
          type: ChatbotActionType.EDIT_SCENE,
          data: {
            sceneId: sceneId,
          },
        },
      ],
    });
  }

  async sendChatbotCreateSceneAction(): Promise<void> {
    this.eventManagerService.emitHomeLinkNativeUpdate({
      target: HomeLinkNativeControlUpdateTarget.CHATBOT,
      payload: [
        {
          type: ChatbotActionType.CREATE_SCENE,
          data: {},
        },
      ],
    });
  }

  async buildAiSceneBySnapshot(dto: ChatbotBuildSceneBySnapshotInputData): Promise<void> {
    await this.sceneProvider.buildSceneBySnapshot(dto);
  }

  // AI - Music

  /**
   * 获取空闲播放器
   */
  async getChatbotFreeMusicPlayer(userId: string): Promise<string | null> {
    return await this.musicProvider.getChatbotAvailableMusicPlayer(userId);
  }

  /**
   * 获取播放器信息列表
   */
  async getChatbotMusicPlayerList(language: Language): Promise<ChatbotMusicPlayerInfo[]> {
    return await this.musicProvider.getMusicPlayersWithAreaAndName(language);
  }

  /**
   * 抢占音乐播放器
   */

  async chatbotOccupyPlayer(userId: string, playerId: string): Promise<boolean> {
    return await this.musicProvider.chatbotOccupyPlayer(userId, playerId);
  }

  /**
   * 音乐播放接口
   */

  async chatbotMusicPlayerStart(userId: string, playerId: string, url: string, areaIds: string[]): Promise<boolean> {
    return await this.musicProvider.chatbotMusicPlayerStart(userId, playerId, url, areaIds);
  }

  /**
   * 音乐控制接口
   */

  async chatbotMusicPlayerControlCommand(userId: string, playerId: string, command: MusicPlayerControlCommand | undefined, volume: number | undefined) {
    return await this.musicProvider.chatbotMusicPlayerControlCommand(userId, playerId, command, volume);
  }

  // AI - Camera
  async getCameraMetaData(userId: string): Promise<ChatbotCameraMetadataDto[]> {
    return this.cameraProvider.getCameraMetaData(userId);
  }

  async getCameraSnapshot(cameraId: string): Promise<Buffer> {
    return this.cameraProvider.getSnapshot(cameraId);
  }
}
