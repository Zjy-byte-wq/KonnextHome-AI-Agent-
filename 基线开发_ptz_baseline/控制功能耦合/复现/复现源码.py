from langchain_community.llms import OpenAI
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langchain.agents import AgentExecutor, create_react_agent
import requests
import time
import os
from pathlib import Path
from langchain_core.prompts import PromptTemplate
from openai import OpenAI as OAIClient
import json
from langchain_core.callbacks import StdOutCallbackHandler
from PIL import Image
import time
import asyncio
from queue import Queue
from concurrent.futures import ThreadPoolExecutor, as_completed


os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = "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"
os.environ["LANGCHAIN_PROJECT"] = "home-security-dev"

image_queue = Queue()

# 可复用非工具函数·

def _impl_move_to_preset(preset_id: int) -> str:
    cam_ip = os.getenv("CAM_IP", "172.16.10.202")
    cam_user = os.getenv("CAM_USER", "admin")
    cam_pass = os.getenv("CAM_PASS", "Admin.123")
    url = f"http://{cam_ip}/ISAPI/PTZCtrl/channels/1/presets/{preset_id}/goto"
    try:
        resp = requests.put(url, auth=requests.auth.HTTPDigestAuth(cam_user, cam_pass), timeout=8)
        if resp.status_code == 200:
            time.sleep(3)  # 物理移动时间
            return f"OK preset={preset_id}"
        return f"ERR preset={preset_id} status={resp.status_code}"
    except Exception as e:
        return f"ERR preset={preset_id} ex={e}"

def _impl_capture_frame() -> dict:
    """返回 dict: {"url","path","width","height","ts",...}；失败时返回 {"error": "..."}"""
    try:
        raw = capture_frame_tool.invoke({})  # 调用外层 tool，但用 invoke，不用直接函数调用
        data = json.loads(raw)
        return data
    except Exception as e:
        return {"error": f"capture parse error: {e}"}

def _impl_analyze_image_json(url: str, target: str = "垃圾桶") -> dict:
    """严格 JSON 的分析输出"""
    client = OAIClient(api_key=os.getenv("OPENAI_API_KEY", "sk-proj-cEr0nLDcYfasYpvzJaAgT3BlbkFJ3ZcPct39d5Sw28jrFvHI"))
    prompt_text = (
        f"请判断图片中是否存在{target}。只输出 JSON，不要多余文本："
        '{"has_target": <true|false>, "confidence": <0到1>, "reason": "<中文简要理由>"}'
    )
    resp = client.chat.completions.create(
        model="gpt-4o",
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": url}},
            {"type": "text", "text": prompt_text}
        ]}],
        max_tokens=200,
    )
    try:
        obj = json.loads(resp.choices[0].message.content)
        if not isinstance(obj, dict):
            raise ValueError("not dict")
    except Exception:
        txt = resp.choices[0].message.content
        obj = {"has_target": ("有" in txt) or ("存在" in txt) or ("yes" in txt.lower()),
               "confidence": 0.5, "reason": txt[:200]}
    obj["url"] = url
    return obj

@tool
def capture_frame_tool() -> str:
    """抓拍当前画面，保存到 ./data/snap_*.jpg，返回JSON字符串：{"path","url","size_bytes","width","height","ts"}"""

    Path("data").mkdir(exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    save_path = Path("data") / f"snap_{ts}.jpg"

    cam_ip = os.getenv("CAM_IP", "172.16.10.202")
    cam_user = os.getenv("CAM_USER", "admin")
    cam_pass = os.getenv("CAM_PASS", "Admin.123")

    url = f"http://{cam_ip}/ISAPI/Streaming/channels/101/picture"
    resp = requests.get(url, auth=requests.auth.HTTPDigestAuth(cam_user, cam_pass), timeout=8)
    resp.raise_for_status()
    save_path.write_bytes(resp.content)

    size = save_path.stat().st_size
    try:
        with Image.open(save_path) as im:
            w, h = im.size
    except Exception:
        w, h = None, None

    ngrok_url = os.getenv("NGROK_URL", "https://0c07c83a1117.ngrok-free.app")
    http_url = f"{ngrok_url}/{save_path.name}"

    try:
        test_resp = requests.get(http_url, timeout=5)
        test_resp.raise_for_status()
    except Exception as e:
        return json.dumps({"error": f"URL 无法访问: {str(e)}"}, ensure_ascii=False)
    
    result = {
        "path": str(save_path.resolve()),
        "url": http_url,
        "size_bytes": size,
        "width": w,
        "height": h,
        "ts": ts
    }
    return json.dumps(result, ensure_ascii=False)

@tool
def camera_zoom(level: int) -> str:
    """控制摄像头变焦，level为变焦速度（正数放大，负数缩小）"""

    cam_ip = os.getenv("CAM_IP", "172.16.10.202")
    cam_user = os.getenv("CAM_USER", "admin")
    cam_pass = os.getenv("CAM_PASS", "Admin.123")

    url = f"http://{cam_ip}/ISAPI/PTZCtrl/channels/1/continuous"
    headers = {"Content-Type": "application/xml"}
    data = f'''<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<PTZData version=\"2.0\" xmlns=\"http://www.hikvision.com/ver20/XMLSchema\">\n    <zoom>{level}</zoom>\n</PTZData>'''
    
    try:
        resp1 = requests.put(url, headers=headers, data=data, auth=requests.auth.HTTPDigestAuth(cam_user, cam_pass), timeout=8)
        time.sleep(0.5)
        data_stop = f'''<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<PTZData version=\"2.0\" xmlns=\"http://www.hikvision.com/ver20/XMLSchema\">\n    <zoom>0</zoom>\n</PTZData>'''
        resp2 = requests.put(url, headers=headers, data=data_stop, auth=requests.auth.HTTPDigestAuth(cam_user, cam_pass), timeout=8)
        if resp1.status_code == 200 and resp2.status_code == 200:
            return f"摄像头变焦指令已发送，level={level}"
        else:
            return f"变焦失败，状态码: {resp1.status_code}/{resp2.status_code}"
    except Exception as e:
        return f"变焦请求异常: {str(e)}"
    
@tool
def analyze_image_tool(arg: str) -> str:
    """分析图像内容。
    参数必须是一个 JSON 字符串，例如：
    {"url": "https://xxx.jpg", "analysis_request": "请分析图片中的场景"}
    """
    
    try:
        data = json.loads(arg)
        url = data["url"]
        analysis_request = data.get("analysis_request", "请分析图片中的场景")
    except Exception as e:
        return f"参数解析失败: {e}"

    if not url.startswith("http"):
        return "Invalid URL format."
    
    client = OAIClient(api_key=os.getenv("OPENAI_API_KEY", "sk-proj-cEr0nLDcYfasYpvzJaAgT3BlbkFJ3ZcPct39d5Sw28jrFvHI"))
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "user", 
             "content": [
                {"type": "image_url", "image_url": {"url": url}},
                {"type": "text", "text": analysis_request}
            ]}
        ],
        max_tokens=512,
    )
    return response.choices[0].message.content

@tool
def move_to_preset_tool(preset_id: int) -> str:
    """将摄像头移动到指定的预设位置。
    参数：
    - preset_id: 预设位置的编号（从 3 到 9）。
    返回移动结果。
    """
    cam_ip = os.getenv("CAM_IP", "172.16.10.202")
    cam_user = os.getenv("CAM_USER", "admin")
    cam_pass = os.getenv("CAM_PASS", "Admin.123")

    url = f"http://{cam_ip}/ISAPI/PTZCtrl/channels/1/presets/{preset_id}/goto"
    
    try:
        resp = requests.put(url, auth=requests.auth.HTTPDigestAuth(cam_user, cam_pass), timeout=8)
        if resp.status_code == 200:

            # 添加延迟，确保摄像头完成移动
            time.sleep(2)  # 根据摄像头移动时间调整秒数

            return f"摄像头已移动到预设位置 {preset_id}。"
        else:
            return f"移动失败，状态码: {resp.status_code}"
    except Exception as e:
        return f"移动请求异常: {str(e)}"

# @tool
# def find_target_tool() -> str:
#     """自动移动摄像头到预设位置 3 到 9，并抓拍图片，将图片 URL 放入队列。
#     消费者从队列中取出图片 URL 进行分析。
#     如果找到目标，立即停止。
#     """
    
#     async def move_and_capture(preset_id):
#         try:
#             # 移动摄像头
#             move_result = move_to_preset_tool(preset_id)  # 调用内部函数
#             if "失败" in move_result:
#                 return f"移动失败: {move_result}"
            
#             # 抓拍图片
#             capture_result = capture_frame_tool()
#             if "error" in capture_result:
#                 return f"抓拍失败: {capture_result['error']}"
            
#             # 将图片 URL 放入队列
#             image_queue.put(capture_result["url"])
#             return f"预设位置 {preset_id} 的图片已加入队列: {capture_result['url']}"
#         except Exception as e:
#             return f"移动和抓拍失败: {str(e)}"

#     async def analyze_from_queue():
#         results = []
#         while not image_queue.empty():
#             try:
#                 image_url = image_queue.get()
#                 analysis_request = json.dumps({"url": image_url, "analysis_request": "请分析图片中的场景"})
#                 analyze_result = analyze_image_tool(analysis_request)
                
#                 # 检查分析结果是否找到目标
#                 if "目标" in analyze_result:  # 假设分析结果中包含 "目标" 字样
#                     return f"目标已找到: {analyze_result}"
#                 results.append(f"图片分析结果: {analyze_result}")
#             except Exception as e:
#                 results.append(f"分析失败: {str(e)}")
#         return results

#     async def workflow():
#         presets = list(range(3, 10))  # 预设位置列表

#         # 异步移动和抓拍
#         producer_tasks = [move_and_capture(preset_id) for preset_id in presets]
#         await asyncio.gather(*producer_tasks)

#         # 异步分析
#         consumer_results = await analyze_from_queue()
#         return consumer_results

#     # 启动异步任务
#     results = asyncio.run(workflow())
#     return "\n".join(results)
    
@tool
def find_target_tool(arg: str = "") -> str:
    """
    扫描若干预设位，边移动边抓拍，并行上传分析，命中目标就提前返回。
    可选参数（JSON 字符串）：
    {
      "presets": [3,4,5,6,7],   // 要扫描的预设，默认 [3..9]
      "target": "垃圾桶",         // 目标类别，默认 "垃圾桶"
      "max_workers": 3          // 并行分析线程数，默认 3
    }
    返回 JSON：{ "found":bool, "best_preset":int|null, "details":[...], "elapsed_sec":float }
    """
    try:
        cfg = json.loads(arg) if arg else {}
    except Exception as e:
        return json.dumps({"error": f"参数解析失败: {e}"}, ensure_ascii=False)

    presets = cfg.get("presets") or list(range(3, 10))
    target = cfg.get("target", "垃圾桶")
    max_workers = int(cfg.get("max_workers", 3))

    t0 = time.time()
    details = []
    found = False
    best_preset = None

    # 提交的分析任务：(future, preset_id)
    futures = []
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        for pid in presets:
            if found:
                break

            # 1) 串行移动（物理动作不可并发）
            mv = _impl_move_to_preset(pid)
            if not mv.startswith("OK"):
                details.append({"preset": pid, "error": mv})
                continue

            # 2) 抓拍
            shot = _impl_capture_frame()
            if "error" in shot or not shot.get("url"):
                details.append({"preset": pid, "error": shot.get("error", "capture failed")})
                continue

            url = shot["url"]
            # 3) 立刻提交并行分析（相机同时可去下一个 preset）
            fut = pool.submit(_impl_analyze_image_json, url, target)
            futures.append((fut, pid, url))

            # 4) 每提交一次就“尽力收割”已完成的任务（早停）
            done = [item for item in futures if item[0].done()]
            for fut_i, pid_i, url_i in done:
                try:
                    res = fut_i.result()
                except Exception as e:
                    details.append({"preset": pid_i, "url": url_i, "error": f"analyze ex={e}"})
                    futures.remove((fut_i, pid_i, url_i))
                    continue

                item = {
                    "preset": pid_i,
                    "url": url_i,
                    "has_target": bool(res.get("has_target")),
                    "confidence": float(res.get("confidence", 0.0)),
                    "reason": res.get("reason", "")
                }
                details.append(item)
                futures.remove((fut_i, pid_i, url_i))

                if item["has_target"] and not found:
                    found = True
                    best_preset = pid_i
                    break

        # 扫尾：如果还没命中，把剩余未完成的一次性收集
        if not found and futures:
            for fut_i, pid_i, url_i in list(futures):
                try:
                    res = fut_i.result(timeout=6)  # 给个小超时，防止卡死
                except Exception as e:
                    details.append({"preset": pid_i, "url": url_i, "error": f"analyze ex={e}"})
                    continue
                item = {
                    "preset": pid_i,
                    "url": url_i,
                    "has_target": bool(res.get("has_target")),
                    "confidence": float(res.get("confidence", 0.0)),
                    "reason": res.get("reason", "")
                }
                details.append(item)
                if item["has_target"] and not found:
                    found = True
                    best_preset = pid_i

    elapsed = round(time.time() - t0, 3)
    out = {"found": found, "best_preset": best_preset, "details": details, "elapsed_sec": elapsed}
    return json.dumps(out, ensure_ascii=False)

if __name__ == "__main__":

    start_time = time.time()

    prompt = PromptTemplate.from_template("""
    你是一个安防助手，负责分析摄像头画面。
    请严格按照以下格式输出：
    Question: {input}
    Thought: 你的推理
    Action: 工具名
    Action Input: 工具输入（注意：如果工具需要多个参数，请分别提供，而不是逗号分隔的字符串）
    Observation: 工具输出
    ... (可以重复 N 次 Thought/Action/Action Input/Observation)
    Thought: 我现在知道最终答案
    Final Answer: 最终答案

    你可以使用以下工具：
    {tools}

    工具名称：
    {tool_names}

    {agent_scratchpad}
    """)
    model = ChatOpenAI(
        model="gpt-4o",
        temperature=0,
        api_key="sk-proj-cEr0nLDcYfasYpvzJaAgT3BlbkFJ3ZcPct39d5Sw28jrFvHI"
    )
    tools = [camera_zoom, capture_frame_tool, analyze_image_tool, move_to_preset_tool, find_target_tool]
    agent = create_react_agent(model, tools, prompt)
    # 使用标准输出回调捕获调试信息
    callback = StdOutCallbackHandler()
    # 创建 AgentExecutor
    agent_executor = AgentExecutor.from_agent_and_tools(
        agent=agent,
        tools=tools,
        callbacks=[callback],  # 使用标准输出回调
        verbose=True,                 # 在控制台打印 Thought/Action/Observation
        handle_parsing_errors=True,
        max_iterations=50,            # 限制最大迭代次数，防止无限循环
        max_execution_time=300        # 限制最大执行时间，防止长时间运行
    )
    user_input = "帮我看看外面有没有垃圾桶，当前画面没找到的话可以调用find_target_tool"
    
    # 执行用户输入
    result = agent_executor.invoke({"input": user_input}, handle_parsing_errors=True,
                                      config={
                                        "run_name": "door-camera-test", 
                                        "tags": ["camera", "zoom", "analysis"],
                                        "metadata": {"user": "eric", "scene": "door-inspection"}
    })

    print(result)

    end_time = time.time()
    # 打印运行时长
    print(f"运行时间: {end_time - start_time:.2f} 秒")
