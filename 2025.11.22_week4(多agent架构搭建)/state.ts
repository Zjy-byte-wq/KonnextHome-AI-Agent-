import { ChatbotSupportedLanguage } from "../models/chatbot_command.dto";
import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

// 工具调用计划接口
export interface ToolCall {
  toolName: string;
  parameters: Record<string, any>;
  id: string; // 用于追踪工具调用
}

// 工具执行结果接口
export interface ToolResult {
  toolCallId: string;
  toolName: string;
  success: boolean;
  result?: string;
  error?: string;
  executionTime?: number;
}

export const StateAnnotation = Annotation.Root({
  userId: Annotation<string>,
  sessionId: Annotation<string>,
  language: Annotation<ChatbotSupportedLanguage>,
  command: Annotation<string>,
  deviceContext: Annotation<string>,
  
  //  2025/12/22改--新增多agent路由
  routeType: Annotation<string>({
    reducer: (x, y) => y !== undefined ? y : x,
    default: () => 'general_chat',
  }),

  // 工具调用相关字段
  toolCalls: Annotation<ToolCall[]>({
    reducer: (x, y) => y !== undefined ? y : x,
    default: () => [],
  }),
  toolResults: Annotation<ToolResult[]>({
    reducer: (x, y) => {
      // 如果新值是空数组，清空状态；否则追加
      return y.length === 0 ? [] : x.concat(y);
    },
    default: () => [],
  }),
  
  //  2025/12/22改--新增：家居Agent状态
  homeToolCalls: Annotation<ToolCall[]>({
    reducer: (x, y) => y !== undefined ? y : x,
    default: () => [],
  }),
  homeMessages: Annotation<BaseMessage[]>({
    reducer: (x, y) => {
      const combined = x.concat(y);
      return combined.slice(-12);
    },
    default: () => [],
  }),

  // 2025/12/22改--新增：视觉Agent状态
  visionToolCalls: Annotation<ToolCall[]>({
    reducer: (x, y) => y !== undefined ? y : x,
    default: () => [],
  }),
  visionMessages: Annotation<BaseMessage[]>({
    reducer: (x, y) => {
      const combined = x.concat(y);
      return combined.slice(-12);
    },
    default: () => [],
  }),

  llmResponse: Annotation<string>,
  finalResponse: Annotation<string>,
  audio: Annotation<string>,
  // 对话历史 
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => {
      const combined = x.concat(y);
      // 只保留最新的12条消息（6轮对话）
      return combined.slice(-12);
    },
    default: () => [],
  }),
  error: Annotation<any>,
  modelName: Annotation<string>, // 动态模型名称
  executionMetadata: Annotation<{
    startTime?: Date;
    llmProcessingTime?: number;
    totalToolsExecuted?: number;
    parallelExecutionTime?: number;
  } | undefined>,
});

export type GraphState = typeof StateAnnotation.State;

