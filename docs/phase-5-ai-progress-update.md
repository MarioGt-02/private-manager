1. Scope

Phase 5 只实现：

Tell AI What Happened / AI Progress Update

用户针对一个已经存在的 Object，用自然语言描述刚刚完成、改变、遇到的情况。

AI 根据该 Object 当前状态判断需要更新：

current_state
next_action
已完成的 checklist items
必要时新增少量 checklist items
object_updates

不实现：

Replan
board-wide AI
What should I do now?
自动状态移动
自动 Done
多 Object 推理
2. Entry Point

在 Object Drawer 中启用现有按钮：

✨ Tell AI What Happened

点击后打开一个小型对话/输入区域。

最简单 MVP 可以只需要：

What happened?

[ 桌腿和桌面都打磨好了 ]

[ Update Progress ]

不需要做完整多轮聊天。

3. Object Context

只发送当前 Object 的信息：

{
  id,
  title,
  status,
  goal,
  currentState,
  nextAction,
  checklist,
  recentUpdates
}

其中 recentUpdates 只取少量最近记录，例如：

5–10 条

不要发送整个 board。

不要发送其他 Objects。

4. Request Type

推荐：

type ProgressUpdateRequest = {
  objectId: string;
  message: string;
};

客户端只提交：

objectId
用户自然语言说明

服务器自己从 PostgreSQL 加载 Object 上下文。

不要让客户端上传一整份 Object 当作可信真源。

5. Route

推荐：

POST /api/ai/objects/[objectId]/progress

或者等价结构：

POST /api/ai/object-progress

如果使用统一 route：

{
  objectId,
  message
}

即可。

6. Authentication

必须第一步：

requireAuth()

然后才：

validate input
load Object
call OpenAI

未认证时：

401
0 DB reads/writes if practical
0 OpenAI calls
7. AI Responsibility

AI 要回答的问题不是：

“整个项目接下来怎么重新规划？”

而是：

“根据用户刚刚说的内容，当前真实进度发生了什么变化？”

它可以：

更新 Current State
识别某些 checklist 已完成
给出新的 Next Action
必要时新增少量 checklist item

它不可以：

删除一堆原有 checklist
随意重排整个计划
自动改 Object status
自动标记 Object done
创建新的 Objects
8. Structured Output

推荐输出：

type AIProgressUpdate = {
  currentState: string;
  nextAction: string;
  completedItemIds: string[];
  reopenedItemIds: string[];
  newChecklistItems: {
    title: string;
  }[];
  summary: string;
};

说明：

currentState

更新后的真实当前状态。

nextAction

更新后的一个具体下一步。

completedItemIds

AI 确认用户刚刚完成的 checklist items。

reopenedItemIds

如果用户明确说某件之前以为完成的事情实际上要重做，可以取消完成。

默认应为空。

newChecklistItems

只有当新情况确实引入了新的必要步骤时才添加。

通常 0–3 个。

summary

用于 Activity Log：

User reported that the desk legs and tabletop were sanded.
9. 不允许直接传 checklist title

完成 checklist 时优先返回：

item ID

而不是：

"打磨桌腿"

因为 title 可能重复。

服务器提供给 AI 的 checklist context 应包含：

{
  id,
  title,
  completed,
  position
}

AI structured output 返回对应 IDs。

10. Backend Validation

后端必须验证：

Object 存在
completedItemIds 都属于该 Object
reopenedItemIds 都属于该 Object
没有重复 IDs
同一个 ID 不能同时 completed + reopened
currentState 非空
nextAction 非空
新 checklist 标题有效
新增数量有限
AI 不能改 status

非法 AI 返回：

AI_INVALID_RESPONSE

不写数据库。

11. Preserve Existing Work

核心原则：

不要重写用户已经完成的工作。

如果原 checklist：

✅ 确定尺寸
✅ 买木材
⬜ 切桌腿
⬜ 打磨
⬜ 组装

用户说：

“桌腿切完了。”

正确：

✅ 确定尺寸
✅ 买木材
✅ 切桌腿
⬜ 打磨
⬜ 组装

不能把前两个 completed 状态弄丢。

12. Reopening Completed Items

默认 AI 不应随便取消完成。

只有用户明确表达：

这个步骤其实还没做完
要重新做
之前做错了

才允许：

reopenedItemIds
13. New Checklist Items

AI 可以新增少量步骤，但要克制。

例如：

用户说：

“安装的时候发现还需要买墙塞。”

可以新增：

购买适合墙体的膨胀塞

但不能因为一句进度更新就重新生成 12 条 checklist。

建议上限：

3
14. No Checklist Deletion

Phase 5 不允许 AI 删除 checklist。

删除、整体重构、重排属于：

Phase 7 — Replan
15. No Reordering

AI Progress Update 不应该重新排列已有 checklist。

新项目默认追加到合理位置；MVP 可以直接追加到末尾。

如果以后需要智能插入，再单独做。

16. Status Boundary

AI Progress Update 不自动改变：

idea
ready
doing
waiting
done

即使 AI 判断“看起来做完了”，也只能更新：

Current State
Next Action
Checklist

用户自己拖到 Done。

17. Next Action Rule

AI 每次必须返回：

一个具体、立即可以执行的下一步。

坏例子：

继续推进项目
继续安装
继续学习

好例子：

用水平尺确认洞洞板位置，并在墙上标记四个固定孔位。
18. Current State Rule

Current State 应该描述：

到现在为止，客观上已经做到哪里。

例如：

洞洞板安装位置已确定，墙面孔位已标记，目前还未钻孔固定。

不能写成：

下一步需要钻孔。

那属于 Next Action。

19. Prompt

系统提示词核心：

You are updating progress for one existing Object in Private Manager.

Your job is to interpret what the user just reported and update the factual state of this Object.

Do not replan the entire Object.

Do not create new Objects.

Do not change lifecycle status.

Preserve previously completed checklist work.

Only mark checklist items completed when the user's message reasonably supports that conclusion.

Only reopen completed items when the user clearly indicates they are incomplete or must be redone.

Add new checklist items only when the new information introduces a genuinely necessary missing step. Keep additions minimal.

Return:
- updated currentState
- one concrete nextAction
- completed checklist item IDs
- reopened checklist item IDs
- up to a few newly required checklist items
- a concise activity summary

Current State describes factual progress.

Next Action is one immediately actionable step.

If the user's report is ambiguous, be conservative rather than inventing progress.
20. Transaction

应用 AI Progress Update 必须事务化：

BEGIN

UPDATE objects.current_state
UPDATE objects.next_action
UPDATE checklist completion states
INSERT new checklist items if needed
UPDATE objects.updated_at
INSERT object_updates

COMMIT

失败：

ROLLBACK
21. Activity Event

建议事件类型：

ai_progress_update

content 可以是：

Desk legs and tabletop were sanded; next action updated.

不要存 hidden reasoning。

22. UI Preview

我建议 不要直接一按就写数据库。

最好：

用户输入进度
↓
AI 分析
↓
显示 Preview
↓
用户确认 Apply
↓
DB

例如：

AI Progress Update

Current State
桌腿和桌面已经完成打磨。

Next Action
开始桌子的试装并检查尺寸。

Checklist changes
✓ 打磨桌腿
✓ 打磨桌面

New checklist
+ 检查桌面是否翘曲

[ Cancel ] [ Apply Update ]

这样用户仍然掌控最终修改。

23. Recommended Flow
Tell AI What Happened
↓
用户输入
↓
Analyze
↓
AI structured result
↓
Preview
↓
Apply Update
↓
backend validates again
↓
transaction
↓
Object updated
24. Analyze ≠ Mutate

建议两个边界：

POST /api/ai/objects/[id]/progress/analyze
POST /api/ai/objects/[id]/progress/apply

或者：

/api/ai/object-progress/analyze
/api/ai/object-progress/apply

其中：

analyze
OpenAI call
0 DB mutations
apply
0 OpenAI calls
DB transaction

和 AI Create 一样保持：

AI proposes
User decides
Backend validates
Database persists
25. Apply Request

Apply 时不要重新调用 AI。

发送当前 preview：

type ApplyProgressUpdateRequest = {
  objectId: string;
  update: AIProgressUpdate;
};

服务器重新验证 IDs 与当前 DB 状态。

26. Stale Data Protection

因为 Analyze 和 Apply 之间 Object 可能被修改，Apply 时必须重新加载最新 Object。

至少验证：

item IDs 仍存在
item 仍属于该 Object
Object 仍存在

MVP 不需要完整 version locking。

27. Error Cases

需要处理：

INVALID_REQUEST
OBJECT_NOT_FOUND
AI_UNAVAILABLE
AI_INVALID_RESPONSE
RATE_LIMITED
UPDATE_CONFLICT
DATABASE_ERROR
UNAUTHORIZED

AI失败：

不丢用户输入
不改 DB

Apply失败：

Preview 保留
不显示成功
28. No Hidden AI Calls

以下操作仍然 0 AI：

页面加载
拖卡片
手改字段
Checklist 增删改
check/uncheck
打开 Drawer
打开 Progress UI
Apply AI 已生成的更新

只有：

Analyze progress

调用 OpenAI。

29. Tests

至少测试：

user says completed step
→ correct checklist ID marked completed

user reports multiple steps
→ multiple items completed

user says one task must be redone
→ reopened ID

ambiguous report
→ conservative result

new necessary step
→ ≤3 additions

foreign checklist ID
→ rejected

completed+reopened same ID
→ rejected

unauthenticated analyze
→ 0 OpenAI calls

unauthenticated apply
→ 0 DB writes

analyze
→ 0 DB writes

apply
→ 0 OpenAI calls

DB failure
→ rollback
30. Acceptance Example

Object:

制作电脑桌

Checklist:

✅ 确定尺寸
✅ 买木材
⬜ 切桌腿
⬜ 打磨
⬜ 试装
⬜ 组装

用户：

桌腿已经切好了，而且都打磨了一遍。

AI Preview：

Current State
桌腿已经切割并完成初步打磨，材料准备阶段基本完成。

Next Action
先进行桌腿和桌面的试装，检查尺寸与连接位置。

Checklist changes
✓ 切桌腿
✓ 打磨

用户点击：

Apply Update

DB 最终：

current_state updated
next_action updated
对应 checklist completed = true
object_updates += ai_progress_update
31. Definition of Done

Phase 5 完成条件：

Tell AI What Happened 可用
用户可以输入自然语言进度
AI 只看单个 Object
Analyze 不写数据库
AI 返回结构化 progress update
可以 preview
用户确认后才 Apply
Apply 不调用 OpenAI
Current State 更新
Next Action 更新
Checklist completed/reopened 正确
必要时能新增少量 checklist
不删除 checklist
不整体 Replan
不改 Object status
DB transaction
activity 写入
auth 保护
AI失败不改 DB
Apply失败不产生部分修改
TypeScript / ESLint / tests / build 全过
32. 永久原则
Progress Update = 理解发生了什么

不是：

重新规划整个 Object

如果需要大改计划：

Phase 7 — Replan