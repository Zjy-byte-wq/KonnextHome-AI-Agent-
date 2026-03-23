import { StateGraph, END, START, MemorySaver } from "@langchain/langgraph";
import { StateAnnotation, GraphState, ToolCall, ToolResult } from "./state";
import { ChatOpenAI } from "@langchain/openai";
import { ToolProvider } from "../tools/tool.provider";
import { ChatbotService } from "../chatbot.service";
import { PinoLogger } from "nestjs-pino";
import { ChatbotSupportedLanguage } from "../models/chatbot_command.dto";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from 'uuid';
import { calculateLlmCost } from '../tools/price';

// LangSmith 追踪工具
interface NodeMetadata {
  nodeType: string;
  stepName: string;
  [key: string]: any;
}

export class ChatbotGraph {
  private llm: ChatOpenAI;
  private graph: any;
  private checkpointer: MemorySaver;

  get modelName(): string {
    return this.llm.modelName || 'gpt-4o';
  }

  constructor(
    private readonly toolProvider: ToolProvider,
    private readonly chatbotService: ChatbotService,
    private readonly logger: PinoLogger
  ) {
    this.llm = new ChatOpenAI({
      temperature: 0,
      model: 'gpt-4o',
    });

    // 初始化内存保存器
    this.checkpointer = new MemorySaver();

    this.graph = this.buildGraph();
  }

  /**
   * build graph
   */
  private buildGraph() {
    const builder = new StateGraph(StateAnnotation)
      .addNode("prepareContext", this.prepareContext.bind(this))
      // 2025/12/22改--新增路由节点
      .addNode("routerAgent", this.routerAgent.bind(this))

      /** 
      .addNode("planningAgent", this.planningAgent.bind(this)) // 2025/12/22改--原始单agent
      **/

      // 2025/12/22改--新增家居Agent和视觉Agent
      .addNode("homePlanning", this.homePlanningAgent.bind(this))
      .addNode("visionPlanning", this.visionPlanningAgent.bind(this))

      // 工具节点
      .addNode("controlLight", this.controlLight.bind(this))
      .addNode("controlCurtain", this.controlCurtain.bind(this))
      .addNode("controlAircon", this.controlAircon.bind(this))
      .addNode("controlUniSwitch", this.controlUniSwitch.bind(this))
      .addNode("controlFloorHeating", this.controlFloorHeating.bind(this))
      .addNode("controlScene", this.controlScene.bind(this))
      .addNode("buildScene", this.buildScene.bind(this))
      .addNode("musicPlay", this.musicPlay.bind(this))
      .addNode("musicControl", this.musicControl.bind(this))
      .addNode("cameraSnapshot", this.cameraSnapshot.bind(this))    //新增
      .addNode("aggregateResults", this.aggregateResults.bind(this))
      .addNode("generateIntelligentResponse", this.generateIntelligentResponse.bind(this))
      .addNode("generateResponse", this.generateResponse.bind(this))
      .addEdge(START, "prepareContext")
      /**
       // 2025/12/22改--原始单Agent
      .addEdge("prepareContext", "planningAgent")
      .addConditionalEdges("planningAgent", this.routeFromPlanning.bind(this))
      **/
      
      // 2025/12/22改--新增家居Agent和视觉Agent路由
      .addEdge("prepareContext", "routerAgent")
      .addConditionalEdges("routerAgent", this.routeFromRouter.bind(this))
      .addConditionalEdges("homePlanning", this.routeFromHomePlanning.bind(this))
      .addConditionalEdges("visionPlanning", this.routeFromVisionPlanning.bind(this))
      
      // 保持不变
      .addEdge("controlLight", "aggregateResults")
      .addEdge("controlCurtain", "aggregateResults")
      .addEdge("controlAircon", "aggregateResults")
      .addEdge("controlUniSwitch", "aggregateResults")
      .addEdge("controlFloorHeating", "aggregateResults")
      .addEdge("controlScene", "aggregateResults")
      .addEdge("buildScene", "aggregateResults")
      .addEdge("musicPlay", "aggregateResults")
      .addEdge("musicControl", "aggregateResults")
      .addEdge("cameraSnapshot", "aggregateResults")
      .addEdge("aggregateResults", "generateIntelligentResponse")
      .addEdge("generateIntelligentResponse", "generateResponse")
      .addEdge("generateResponse", END);

    // 编译graph时添加checkpointer
    return builder.compile({ checkpointer: this.checkpointer });
  }

  // /**
  //  * 从planning路由到下一个节点    // 2025/12/22改--单Agent版本
  //  */
  // private routeFromPlanning(state: GraphState): string[] {
  //   const toolCalls = state.toolCalls || [];
  //   if (toolCalls.length === 0) {
  //     // 没有工具调用，直接生成回复
  //     return ["generateResponse"];
  //   }

  //   const routes = new Set<string>();
  //   for (const toolCall of toolCalls) {
  //     switch (toolCall.toolName) {
  //       case "control_home_light":
  //         routes.add("controlLight");
  //         break;
  //       case "control_home_curtain":
  //         routes.add("controlCurtain");
  //         break;
  //       case "control_home_aircon_station":
  //         routes.add("controlAircon");
  //         break;
  //       case "control_home_uni_switch":
  //         routes.add("controlUniSwitch");
  //         break;
  //       case "control_home_floor_heating":
  //         routes.add("controlFloorHeating");
  //         break;
  //       case "control_home_scene":
  //         routes.add("controlScene");
  //         break;
  //       case "build_home_scene":
  //         routes.add("buildScene");
  //         break;
  //       case "music_play":
  //         routes.add("musicPlay");
  //         break;
  //       case "music_control":
  //         routes.add("musicControl");
  //         break;
  //       case "get_camera_snapshot":
  //         routes.add("cameraSnapshot");
  //         break;
  //       default:
  //         this.logger.warn(`Unknown tool: ${toolCall.toolName}`);
  //     }
  //   }

  //   return Array.from(routes);
  // }



  /**
   * context preparation
   */
  private async prepareContext(state: GraphState) {
    try {
      this.logger.info(`Preparing context for user ${state.userId}`);

      // 生成设备上下文
      const deviceContext = await this.toolProvider.generateDeviceContext(state.userId);

      return {
        deviceContext,
        modelName: this.llm.modelName || 'gpt-4o',
        executionMetadata: {
          startTime: new Date(),
        }
      };
    } catch (error) {
      this.logger.error(`Error in prepareContext: ${error}`);
      return {
        error: error
      };
    }
  }

  /**
   * 2025/12/22改--新增routerAgent
   */
  private async routerAgent(state: GraphState) {
    try {
      this.logger.info(`Router Agent classifying command: ${state.command}`);

      const systemPrompt = `你是一个智能路由助手，需要将用户意图分类为以下三类之一：

    1. "home_control" - 家居设备控制
       关键词：空调、灯、窗帘、地暖、场景、音乐、温度、开关、打开、关闭、调节
       示例："把客厅空调打开"、"调暗卧室灯光"、"播放音乐"

    2. "vision_analysis" - 视觉分析
       关键词：监控、摄像头、门口、看看、是谁、拍照、画面、查看、观察
       示例："门口是谁"、"看看客厅监控"、"拍张照片"

    3. "general_chat" - 日常对话
       示例："你好"、"今天天气怎么样"、"谢谢"

    请只返回分类结果，格式：{"intent": "home_control"}`;

      const startTime = Date.now();
    
      const response = await this.llm.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: state.command }
      ]);

      // 计算成本
      try {
        const usage = calculateLlmCost(
          response,
          this.modelName,
          'standard',
          state.userId,
          state.sessionId,
          state.sessionId,
          undefined,
          state.command
        );
        this.logger.info(`[routerAgent] Cost: $${usage.cost}, Tokens: ${usage.input_tokens}+${usage.output_tokens}`);
      } catch (costError) {
        this.logger.warn(`Failed to calculate LLM cost: ${costError}`);
      }

      const content = response.content as string;
      let intent = 'general_chat'; // 默认值

      // 解析 LLM 返回
      try {
        const parsed = JSON.parse(content);
        intent = parsed.intent || 'general_chat';
      } catch {
        // 回退：关键词匹配
        this.logger.warn('Router LLM response parsing failed, using keyword matching');
        const lowerCommand = state.command.toLowerCase();

        if (/空调|灯|窗帘|地暖|场景|音乐|温度|开关|打开|关闭|调节/.test(lowerCommand)) {
          intent = 'home_control';
        } else if (/监控|摄像头|门口|看看|是谁|拍照|画面|查看|观察/.test(lowerCommand)) {
          intent = 'vision_analysis';
        }
      }

      const routingTime = Date.now() - startTime;
      this.logger.info(`Router classified as: ${intent} (took ${routingTime}ms)`);

      return {
        routeType: intent,
        executionMetadata: {
          ...state.executionMetadata,
          routingTime
        }
      };
    } catch (error) {
      this.logger.error(`Error in routerAgent: ${error}`);
      // 失败时降级到通用对话
      return { 
        routeType: 'general_chat',
        error: error 
      };
    }
  }

  /**
   * 2025/12/22改--新增routeFromRouter
   */
  private routeFromRouter(state: GraphState): string {
    const routeType = state.routeType || 'general_chat';
    
    switch (routeType) {
      case "home_control":
        this.logger.info('Routing to Home Control Agent');
        return "homePlanning";
      case "vision_analysis":
        this.logger.info('Routing to Vision Analysis Agent');
        return "visionPlanning";
      case "general_chat":
      default:
        this.logger.info('Routing to direct response');
        return "generateResponse";
    }
  }

  /**
   * 2025/12/22改--新增homePlanningAgent
   */
  private async homePlanningAgent(state: GraphState) {
    try {
      this.logger.info(`Home Planning Agent processing command: ${state.command}`);

      // 使用家居专属工具
      const tools = await this.toolProvider.generateHomeControlTools(state.userId);
      const llmWithTools = this.llm.bindTools(tools);

      let systemContent = `You are Kon, a smart home control assistant.
  Your role is to control home devices: lights, curtains, air conditioning, floor heating, scenes, and music.

  Available devices:
  ${state.deviceContext}

  Important rules:
  - If location information is unclear, ask the user for clarification
  - When parameters are missing, do not execute directly - ask first
  - Keep responses short and friendly
  - Always use the available tools for device control

  When controlling devices, use the tools provided.`;

      if (state.language === ChatbotSupportedLanguage.MANDARIN) {
        systemContent += '\n\n请用中文回复。';
      }

      const startTime = Date.now();

      // 使用 homeMessages 而不是全局 messages
      const conversationHistory = state.homeMessages || [];

      const messages = [
        { role: 'system', content: systemContent },
        ...conversationHistory.map(msg => ({
          role: msg._getType() === 'human' ? 'user' : 'assistant',
          content: msg.content
        })),
        { role: 'user', content: state.command }
      ];

      const response = await llmWithTools.invoke(messages);

      // 计算成本
      try {
        const usage = calculateLlmCost(
          response,
          this.modelName,
          'standard',
          state.userId,
          state.sessionId,
          state.sessionId,
          undefined,
          state.command
        );
        this.logger.info(`[homePlanningAgent] Cost: $${usage.cost}, Tokens: ${usage.input_tokens}+${usage.output_tokens}`);
      } catch (costError) {
        this.logger.warn(`Failed to calculate LLM cost: ${costError}`);
      }

      const llmProcessingTime = Date.now() - startTime;
      const content = response.content as string;

      // 提取工具调用
      const toolCalls: ToolCall[] = [];
      let isToolCall = false;

      if (response.tool_calls && response.tool_calls.length > 0) {
        isToolCall = true;
        for (const toolCall of response.tool_calls) {
          toolCalls.push({
            id: toolCall.id || uuidv4(),
            toolName: toolCall.name,
            parameters: toolCall.args
          });
        }
        this.logger.info(`Home Agent extracted ${toolCalls.length} tool calls`);
      }

      if (isToolCall) {
        const userMessage = new HumanMessage(state.command);
        return {
          homeToolCalls: toolCalls,  // 存储到 homeToolCalls
          toolCalls: toolCalls,       // 同时存储到全局（用于工具执行）
          llmResponse: content,
          homeMessages: [userMessage], // 更新到 homeMessages
          executionMetadata: {
            ...state.executionMetadata,
            llmProcessingTime
          }
        };
      } else {
        // 直接对话
        const userMessage = new HumanMessage(state.command);
        const aiMessage = new AIMessage(content);

        return {
          homeToolCalls: [],
          toolCalls: [],
          llmResponse: content,
          homeMessages: [userMessage, aiMessage], // 立即添加对话历史
          executionMetadata: {
            ...state.executionMetadata,
            llmProcessingTime
          }
        };
      }
    } catch (error) {
      this.logger.error(`Error in homePlanningAgent: ${error}`);
      return {
        error: error
      };
    }
  }

  /**
   * 2025/12/22改--新增routeFromHomePlanning
   */
  private routeFromHomePlanning(state: GraphState): string[] {
    const toolCalls = state.homeToolCalls || []; // 使用 homeToolCalls
    if (toolCalls.length === 0) {
      return ["generateResponse"];
    }

    const routes = new Set<string>();
    for (const toolCall of toolCalls) {
      switch (toolCall.toolName) {
        case "control_home_light":
          routes.add("controlLight");
          break;
        case "control_home_curtain":
          routes.add("controlCurtain");
          break;
        case "control_home_aircon_station":
          routes.add("controlAircon");
          break;
        case "control_home_uni_switch":
          routes.add("controlUniSwitch");
          break;
        case "control_home_floor_heating":
          routes.add("controlFloorHeating");
          break;
        case "control_home_scene":
          routes.add("controlScene");
          break;
        case "build_home_scene":
          routes.add("buildScene");
          break;
        case "music_play":
          routes.add("musicPlay");
          break;
        case "music_control":
          routes.add("musicControl");
          break;
        default:
          this.logger.warn(`Unknown home tool: ${toolCall.toolName}`);
      }
    }

    return Array.from(routes);
  }

  /**
   * 2025/12/22改--新增从设备上下文中提取摄像头信息
   */
  private extractCameraContext(deviceContext: string): string {
    const lines = deviceContext.split('\n');
    const cameraLines = lines.filter(line => 
      line.includes('Camera') || 
      line.includes('摄像头') || 
      line.includes('=== CAMERAS ===')
    );

    return cameraLines.length > 0 
      ? cameraLines.join('\n') 
      : 'No cameras available';
  }

  /**
   * 2025/12/22改--新增visionPlanningAgent
   */
  private async visionPlanningAgent(state: GraphState) {
    try {
      this.logger.info(`Vision Planning Agent processing command: ${state.command}`);

      // 使用视觉专属工具
      const tools = await this.toolProvider.generateVisionTools(state.userId);
      const llmWithTools = this.llm.bindTools(tools);

      // 从设备上下文中提取摄像头信息
      const cameraContext = this.extractCameraContext(state.deviceContext);

      let systemContent = `You are Kon, a vision analysis assistant.
  Your role is to analyze camera feeds and answer questions about surveillance.

  Available cameras:
  ${cameraContext}

  Your workflow:
  1. When user asks "who is at the door" or "check the camera", call get_camera_snapshot
  2. Analyze the image content
  3. Provide a natural language description

  Important:
  - If camera location is unclear, ask which camera to check
  - Be descriptive about what you observe in the images
  - Keep responses friendly and informative`;

      if (state.language === ChatbotSupportedLanguage.MANDARIN) {
        systemContent += '\n\n请用中文回复。';
      }

      const startTime = Date.now();

      // 使用 visionMessages 而不是全局 messages
      const conversationHistory = state.visionMessages || [];

      const messages = [
        { role: 'system', content: systemContent },
        ...conversationHistory.map(msg => ({
          role: msg._getType() === 'human' ? 'user' : 'assistant',
          content: msg.content
        })),
        { role: 'user', content: state.command }
      ];

      const response = await llmWithTools.invoke(messages);

      // 计算成本
      try {
        const usage = calculateLlmCost(
          response,
          this.modelName,
          'standard',
          state.userId,
          state.sessionId,
          state.sessionId,
          undefined,
          state.command
        );
        this.logger.info(`💰 [visionPlanningAgent] Cost: $${usage.cost}, Tokens: ${usage.input_tokens}+${usage.output_tokens}`);
      } catch (costError) {
        this.logger.warn(`Failed to calculate LLM cost: ${costError}`);
      }

      const llmProcessingTime = Date.now() - startTime;
      const content = response.content as string;

      // 提取工具调用
      const toolCalls: ToolCall[] = [];
      let isToolCall = false;

      if (response.tool_calls && response.tool_calls.length > 0) {
        isToolCall = true;
        for (const toolCall of response.tool_calls) {
          toolCalls.push({
            id: toolCall.id || uuidv4(),
            toolName: toolCall.name,
            parameters: toolCall.args
          });
        }
        this.logger.info(`Vision Agent extracted ${toolCalls.length} tool calls`);
      }

      if (isToolCall) {
        const userMessage = new HumanMessage(state.command);
        return {
          visionToolCalls: toolCalls,  // 存储到 visionToolCalls
          toolCalls: toolCalls,         // 同时存储到全局（用于工具执行）
          llmResponse: content,
          visionMessages: [userMessage], // 更新到 visionMessages
          executionMetadata: {
            ...state.executionMetadata,
            llmProcessingTime
          }
        };
      } else {
        // 直接对话
        const userMessage = new HumanMessage(state.command);
        const aiMessage = new AIMessage(content);

        return {
          visionToolCalls: [],
          toolCalls: [],
          llmResponse: content,
          visionMessages: [userMessage, aiMessage], // 立即添加对话历史
          executionMetadata: {
            ...state.executionMetadata,
            llmProcessingTime
          }
        };
      }
    } catch (error) {
      this.logger.error(`Error in visionPlanningAgent: ${error}`);
      return {
        error: error
      };
    }
  }

  /**
   * 2025/12/22改--新增routeFromVisionPlanning
   */
  private routeFromVisionPlanning(state: GraphState): string[] {
    const toolCalls = state.visionToolCalls || []; // 使用 visionToolCalls
    if (toolCalls.length === 0) {
      return ["generateResponse"];
    }

    const routes = new Set<string>();
    for (const toolCall of toolCalls) {
      switch (toolCall.toolName) {
        case "get_camera_snapshot":
          routes.add("cameraSnapshot");
          break;
        default:
          this.logger.warn(`Unknown vision tool: ${toolCall.toolName}`);
      }
    }

    return Array.from(routes);
  }


//   /**
//    * planning agent - 处理llm    // 2025/12/22改--单Agent版本
//    */
//   private async planningAgent(state: GraphState) {
//     try {
//       this.logger.info(`Planning Agent processing command: ${state.command}`);

//       this.logger.info(`heree`)
//       // 动态获取工具并绑定到 LLM
//       const tools = await this.toolProvider.generateControlTools(state.userId);
//       const llmWithTools = this.llm.bindTools(tools);

//       let systemContent = `Acts like a smart home assistant, your name is Kon. 
// I will be your user, you will be my assistant and help with some home tasks.
// Do not write all the conversation at once, wait for my response.
// I want you to only speak with a kind tone.
// Do not mention anything related to AI and do not ask me for context.
// If you do not 100 percent understand the user prompt or the user prompt does not provide clear location information, ask again and do not execute it directly.
// If the user's request includes or is similar to any scene trigger phrases, kindly confirm if they wish to trigger a specific scene.
// When the user request does not include any required parameters, ask again and do not execute it directly.
// Keep the response short and one sentence.
// CRITICAL: When user mentions music, songs, listening, or any musical content, you MUST call the music tool with appropriate search terms. 


// When controlling devices, always use the available tools. The tools will handle the actual device control.`;

//       if (state.language === ChatbotSupportedLanguage.MANDARIN) {
//         systemContent += '\n\n请用中文回复。';
//       }

//       // 将设备上下文添加到系统消息中
//       if (state.deviceContext) {
//         systemContent += `\n\nAvailable devices:\n${state.deviceContext}`;
//       }

//       const startTime = Date.now();

//       // 构建包含历史消息的对话
//       const messages = [
//         { role: 'system', content: systemContent },
//         // 添加历史对话
//         ...state.messages.map(msg => ({
//           role: msg._getType() === 'human' ? 'user' : 'assistant',
//           content: msg.content
//         })),
//         // 添加当前用户消息
//         { role: 'user', content: state.command }
//       ];

//       // 调用绑定了工具的 LLM
//       const response = await llmWithTools.invoke(messages);

//       // Calculate LLM cost
//       try {
//         const usage = calculateLlmCost(
//           response,
//           this.modelName,
//           'standard',
//           state.userId,
//           state.sessionId,
//           state.sessionId,
//           undefined,
//           state.command
//         );
//         this.logger.info(`💰 [planningAgent] Cost: $${usage.cost}, User Total: $${usage.total_price}, Today: $${usage.today_price}, Tokens: ${usage.input_tokens}+${usage.output_tokens}`);
//       } catch (costError) {
//         this.logger.warn(`Failed to calculate LLM cost: ${costError}`);
//       }

//       const llmProcessingTime = Date.now() - startTime;
//       const content = response.content as string;

//       // 检查是否有工具调用
//       const toolCalls: ToolCall[] = [];
//       let isToolCall = false;

//       // LangChain 官方工具调用会在 response.tool_calls 中
//       if (response.tool_calls && response.tool_calls.length > 0) {
//         isToolCall = true;
//         for (const toolCall of response.tool_calls) {
//           toolCalls.push({
//             id: toolCall.id || uuidv4(),
//             toolName: toolCall.name,
//             parameters: toolCall.args
//           });
//         }
//         this.logger.info(`LangChain extracted ${toolCalls.length} tool calls`);
//       } else {
//         // 回退：尝试解析 JSON 格式的工具调用（保持兼容性）
//         try {
//           if (content.includes('toolCalls')) {
//             let jsonContent = content;

//             const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
//             if (jsonMatch) {
//               jsonContent = jsonMatch[1];
//             } else {
//               const startIndex = content.indexOf('{');
//               const endIndex = content.lastIndexOf('}');
//               if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
//                 jsonContent = content.substring(startIndex, endIndex + 1);
//               }
//             }

//             const parsed = JSON.parse(jsonContent);
//             if (parsed.toolCalls && Array.isArray(parsed.toolCalls)) {
//               for (const call of parsed.toolCalls) {
//                 toolCalls.push({
//                   id: uuidv4(),
//                   toolName: call.toolName,
//                   parameters: call.parameters
//                 });
//               }
//               isToolCall = true;
//               this.logger.info(`Fallback: extracted ${toolCalls.length} tool calls from JSON`);
//             }
//           }
//         } catch (error) {
//           this.logger.info(`No tool calls detected. Response is conversational.`);
//         }
//       }

//       if (isToolCall) {
//         this.logger.info(`Planning Agent generated ${toolCalls.length} tool calls`);
//         // 工具调用模式下，先添加用户消息，AI回复将在generateIntelligentResponse中添加
//         const userMessage = new HumanMessage(state.command);
//         return {
//           toolCalls,
//           llmResponse: content,
//           messages: [userMessage],
//           executionMetadata: {
//             ...state.executionMetadata,
//             llmProcessingTime
//           }
//         };
//       } else {
//         // 直接对话回复，不需要工具调用
//         this.logger.info(`Planning Agent provided conversational response`);

//         // 创建对话历史记录
//         const userMessage = new HumanMessage(state.command);
//         const aiMessage = new AIMessage(content);

//         return {
//           toolCalls: [],
//           llmResponse: content,
//           messages: [userMessage, aiMessage], // 直接对话模式下立即添加对话历史
//           executionMetadata: {
//             ...state.executionMetadata,
//             llmProcessingTime
//           }
//         };
//       }
//     } catch (error) {
//       this.logger.error(`Error in planningAgent: ${error}`);
//       return {
//         error: error
//       };
//     }
//   }

  /**
   * control light
   */
  private async controlLight(state: GraphState) {
    return this.executeToolCalls(state, 'control_home_light');
  }

  /**
   * control curtain
   */
  private async controlCurtain(state: GraphState) {
    return this.executeToolCalls(state, 'control_home_curtain');
  }

  /**
   * control aircon
   */
  private async controlAircon(state: GraphState) {
    return this.executeToolCalls(state, 'control_home_aircon_station');
  }

  /**
   * control uni switch
   */
  private async controlUniSwitch(state: GraphState) {
    return this.executeToolCalls(state, 'control_home_uni_switch');
  }

  /**
   * control floor heating
   */
  private async controlFloorHeating(state: GraphState) {
    return this.executeToolCalls(state, 'control_home_floor_heating');
  }

  /**
   * control scene
   */
  private async controlScene(state: GraphState) {
    return this.executeToolCalls(state, 'control_home_scene');
  }

  /**
   * build scene
   */
  private async buildScene(state: GraphState) {
    return this.executeToolCalls(state, 'build_home_scene');
  }

  /**
   * music play
   */
  private async musicPlay(state: GraphState) {
    return this.executeToolCalls(state, 'music_play');
  }

  /**
   * music control
   */
  private async musicControl(state: GraphState) {
    return this.executeToolCalls(state, 'music_control');
  }

  private async cameraSnapshot(state: GraphState) {
    return this.executeToolCalls(state, 'get_camera_snapshot');
  }

  /**
   * 2025/12/22改--Generic tool execution helper
   */
  private async executeToolCalls(state: GraphState, toolName: string) {
    try {
      const toolCalls = state.toolCalls.filter(tc => tc.toolName === toolName);
      this.logger.info(`Executing ${toolCalls.length} ${toolName} tool calls`);

      const results: ToolResult[] = [];

      for (const toolCall of toolCalls) {
        const startTime = Date.now();

        const result: ToolResult = {
          toolCallId: toolCall.id,
          toolName: toolCall.toolName,
          success: false,
          result: undefined,
          error: undefined
        };

        try {
          const params = toolCall.parameters;
          if (!params || typeof params !== 'object' || Array.isArray(params)) {
            result.success = false;
            result.error = 'Invalid parameters';
            this.logger.error(`Invalid parameters for ${toolName}: ${JSON.stringify(params)}`);
          } else {
            // 改进：根据工具类型动态选择工具集
            let tools;
            if (toolName === 'get_camera_snapshot') {
              // 视觉工具
              tools = await this.toolProvider.generateVisionTools(state.userId);
            } else {
              // 家居工具
              tools = await this.toolProvider.generateHomeControlTools(state.userId);
            }

            const tool = tools.find(t => t.name === toolName);

            if (tool) {
              const toolResult = await tool.invoke(params);
              result.success = true;
              result.result = toolResult;
            } else {
              result.success = false;
              result.error = `${toolName} tool not found`;
            }
          }
        } catch (error: any) {
          result.success = false;
          result.error = error?.message || `${toolName} control failed`;
          this.logger.error(`Error in ${toolName}: ${error?.message}`);
        }

        result.executionTime = Date.now() - startTime;
        results.push(result);
      }

      return {
        toolResults: results
      };
    } catch (error) {
      this.logger.error(`Error in ${toolName}: ${error}`);
      return {
        error: error
      };
    }
  }


  // /**
  //  * Generic tool execution helper    // 2025/12/22改--单Agent版本
  //  */
  // private async executeToolCalls(state: GraphState, toolName: string) {
  //   try {
  //     const toolCalls = state.toolCalls.filter(tc => tc.toolName === toolName);
  //     this.logger.info(`Executing ${toolCalls.length} ${toolName} tool calls`);

  //     const results: ToolResult[] = [];

  //     for (const toolCall of toolCalls) {
  //       const startTime = Date.now();

  //       const result: ToolResult = {
  //         toolCallId: toolCall.id,
  //         toolName: toolCall.toolName,
  //         success: false,
  //         result: undefined,
  //         error: undefined
  //       };

  //       try {
  //         const params = toolCall.parameters;
  //         if (!params || typeof params !== 'object' || Array.isArray(params)) {
  //           result.success = false;
  //           result.error = 'Invalid parameters';
  //           this.logger.error(`Invalid parameters for ${toolName}: ${JSON.stringify(params)}`);
  //         } else {


  //           const tools = await this.toolProvider.generateControlTools(state.userId);
  //           const tool = tools.find(t => t.name === toolName);

  //           if (tool) {
  //             const toolResult = await tool.invoke(params);
  //             result.success = true;
  //             result.result = toolResult;
  //           } else {
  //             result.success = false;
  //             result.error = `${toolName} tool not found`;
  //           }
  //         }
  //       } catch (error: any) {
  //         result.success = false;
  //         result.error = error?.message || `${toolName} control failed`;
  //         this.logger.error(`Error in ${toolName}: ${error?.message}`);
  //       }

  //       result.executionTime = Date.now() - startTime;
  //       results.push(result);
  //     }

  //     return {
  //       toolResults: results
  //     };
  //   } catch (error) {
  //     this.logger.error(`Error in ${toolName}: ${error}`);
  //     return {
  //       error: error
  //     };
  //   }
  // }

  /**
   * generate res
   */
  private async generateIntelligentResponse(state: GraphState) {
    try {
      this.logger.info(`Generating intelligent response for user ${state.userId}`);

      const toolResults = state.toolResults || [];
      const successfulResults = toolResults.filter(r => r.success === true);
      const failedResults = toolResults.filter(r => r.success === false);

      if (toolResults.length === 0) {
        // 没有工具执行，使用LLM直接回复
        const systemContent = `You are Kon, a friendly smart home assistant. The user said: "${state.command}". 
        No device controls were needed. Respond naturally and helpfully.`;

        if (state.language === ChatbotSupportedLanguage.MANDARIN) {
          systemContent + ' 请用中文回复。';
        }

        const response = await this.llm.invoke([
          { role: 'system', content: systemContent },
          { role: 'user', content: state.command }
        ]);

        // Calculate LLM cost
        try {
          const usage = calculateLlmCost(
            response,
            this.modelName,
            'standard',
            state.userId,
            state.sessionId,
            state.sessionId,
            undefined,
            state.command
          );
          this.logger.info(`💰 [generateIntelligentResponse-noTools] Cost: $${usage.cost}, User Total: $${usage.total_price}, Tokens: ${usage.input_tokens}+${usage.output_tokens}`);
        } catch (costError) {
          this.logger.warn(`Failed to calculate LLM cost: ${costError}`);
        }

        // 创建对话历史记录
        const userMessage = new HumanMessage(state.command);
        const aiMessage = new AIMessage(response.content as string);

        return {
          llmResponse: response.content as string,
          messages: [userMessage, aiMessage]
        };
      }

      // 有工具执行，生成基于结果的智能回复
      // 检查是否有摄像头工具结果包含图片
      let hasImageContent = false;
      const processedMessages: any[] = [];
      
      // 处理工具结果，特别是摄像头快照
      const toolResultSummaries: string[] = [];
      for (const result of successfulResults) {
        if (result.toolName === 'get_camera_snapshot' && result.result) {
          const imagePayload = this.chatbotService.parseToolImagePayload(result.result);
          if (imagePayload && imagePayload.langchainContent) {
            hasImageContent = true;
            processedMessages.push(...imagePayload.langchainContent);
            // 为系统消息提供简化的结果描述，而不是完整的JSON
            toolResultSummaries.push(`${result.toolName}: Camera snapshot captured successfully`);
          } else {
            toolResultSummaries.push(`${result.toolName}: ${result.result}`);
          }
        } else {
          toolResultSummaries.push(`${result.toolName}: ${result.result}`);
        }
      }

      let systemContent = `You are Kon, a friendly smart home assistant. Based on the following device control results, generate a natural, helpful response:

Successful actions: ${toolResultSummaries.join(', ')}
Failed actions: ${failedResults.map(r => `${r.toolName}: ${r.error}`).join(', ')}

User's original request: "${state.command}"

Generate a natural response that:
1. Confirms what was successfully completed
2. Mentions any failures if they occurred
3. Keeps a friendly, helpful tone
4. Is concise but informative
5. Do not mention the device id, use the natural language to describe the device`;

      if (hasImageContent) {
        systemContent += '\n6. If there are camera snapshots, acknowledge that you can see the images and provide relevant observations if helpful.';
      }

      if (state.language === ChatbotSupportedLanguage.MANDARIN) {
        systemContent += '\n\n请用中文回复。';
      }

      // 构建消息数组，包含系统消息和可能的图片内容
      const messages = [
        { role: 'system', content: systemContent }
      ];
      
      // 如果有图片内容，添加到消息中
      if (processedMessages.length > 0) {
        messages.push({
          role: 'user',
          content: processedMessages,
        });
      }

      const response = await this.llm.invoke(messages);

      // Calculate LLM cost
      try {
        const usage = calculateLlmCost(
          response,
          this.modelName,
          'standard',
          state.userId,
          state.sessionId,
          state.sessionId,
          undefined,
          state.command
        );
        this.logger.info(`💰 [generateIntelligentResponse-withTools] Cost: $${usage.cost}, User Total: $${usage.total_price}, Tokens: ${usage.input_tokens}+${usage.output_tokens}`);
      } catch (costError) {
        this.logger.warn(`Failed to calculate LLM cost: ${costError}`);
      }

      // 只添加AI回复
      const aiMessage = new AIMessage(response.content as string);

      return {
        llmResponse: response.content as string,
        messages: [aiMessage],
        executionMetadata: {
          ...state.executionMetadata,
          totalToolsExecuted: toolResults.length,
          parallelExecutionTime: toolResults.reduce((sum, r) => sum + (r.executionTime || 0), 0)
        }
      };
    } catch (error) {
      this.logger.error(`Error in generateIntelligentResponse: ${error}`);

      const fallbackResponse = state.language === ChatbotSupportedLanguage.ENGLISH
        ? "I completed your request."
        : "我已完成您的请求。";

      // 只添加AI回复
      const aiMessage = new AIMessage(fallbackResponse);

      return {
        llmResponse: fallbackResponse,
        messages: [aiMessage]
      };
    }
  }

  /**
   * aggregate results
   */
  private async aggregateResults(state: GraphState) {
    try {
      this.logger.info(`Aggregating results for user ${state.userId}`);

      const toolResults = state.toolResults || [];
      const successfulResults = toolResults.filter(r => r.success === true);
      const failedResults = toolResults.filter(r => r.success === false);

      let finalResponse = '';
      if (failedResults.length > 0) {
        finalResponse = `Some tools failed to execute: ${failedResults.map(r => `${r.toolName}: ${r.error}`).join(', ')}.`;
      } else if (successfulResults.length === 0) {
        finalResponse = "No tools were executed.";
      } else {
        finalResponse = `All tools executed successfully.`;
      }

      return {
        llmResponse: finalResponse,
        executionMetadata: {
          ...state.executionMetadata,
          totalToolsExecuted: toolResults.length,
          parallelExecutionTime: toolResults.reduce((sum, r) => sum + (r.executionTime || 0), 0)
        }
      };
    } catch (error) {
      this.logger.error(`Error in aggregateResults: ${error}`);
      return {
        error: error
      };
    }
  }

  /**
   * generate response
   */
  private async generateResponse(state: GraphState) {
    try {
      this.logger.info('Generating final response');
      this.logger.info(`generateResponse state llmResponse: ${JSON.stringify(state.llmResponse)}`);

      // error response
      if (state.error) {
        const errorResponse = state.language === ChatbotSupportedLanguage.ENGLISH
          ? "I'm sorry, there was an error processing your request."
          : "抱歉，处理您的请求时出现了错误";

        const audio = await this.chatbotService.synthesizeSpeechOpenAI(errorResponse);

        return {
          finalResponse: errorResponse,
          audio,
          // 清空工具调用相关状态，准备下一轮对话
          toolCalls: [],
          toolResults: []
        };
      }

      // 获取和清理final response
      let finalResponse = state.llmResponse || (
        state.language === ChatbotSupportedLanguage.ENGLISH
          ? "I understand your request."
          : "我理解了您的请求"
      );

      // 检查是否为JSON格式（避免用户看到技术细节）
      if (this.isJsonResponse(finalResponse)) {
        this.logger.warn('Detected JSON response in llmResponse, using fallback');
        this.logger.debug(`Original response (first 200 chars): ${finalResponse.substring(0, 200)}`);
        finalResponse = state.language === ChatbotSupportedLanguage.ENGLISH
          ? "I understand your request and I'm working on it."
          : "我理解了您的请求，正在为您处理。";
      }

      const audio = await this.chatbotService.synthesizeSpeechOpenAI(finalResponse);

      // Finalize token usage for this request
      if (state.sessionId) {
        try {
          const { priceCalculator } = await import('../tools/price');
          priceCalculator.finalizeRequestTokens(state.sessionId);
        } catch (error) {
          this.logger.warn(`Failed to finalize request tokens: ${error}`);
        }
      }

      return {
        finalResponse,
        audio,
        // 清空工具调用相关状态，准备下一轮对话
        toolCalls: [],
        toolResults: []
      };
    } catch (error) {
      this.logger.error(`Error in generateResponse: ${error}`);

      const errorResponse = state.language === ChatbotSupportedLanguage.ENGLISH
        ? "I'm sorry, there was an error processing your request."
        : "抱歉，处理您的请求时出现了错误";

      const audio = await this.chatbotService.synthesizeSpeechOpenAI(errorResponse);

      return {
        error: error,
        finalResponse: errorResponse,
        audio,
        // 清空工具调用相关状态，准备下一轮对话
        toolCalls: [],
        toolResults: []
      };
    }
  }


  /**
   * 检测是否为JSON格式响应
   */
  private isJsonResponse(response: string): boolean {
    if (!response) return false;

    const trimmed = response.trim();

    // 检查是否以JSON格式开始和结束
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'));
  }

  /**
   * Execute Graph
   */
  async invoke(input: Partial<GraphState>, config?: any): Promise<GraphState> {
    this.logger.info('Invoking chatbot graph');

    // 在config中设置超时
    const configWithTimeout = {
      ...config,
      timeout: 60000 // 60秒超时
    };

    return await this.graph.invoke(input, configWithTimeout);
  }


}
