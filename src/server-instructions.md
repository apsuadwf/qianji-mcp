## 钱迹 MCP 使用说明

本服务器用于查询钱迹中的用户、账本、资产、分类、标签、账单和预算，也可管理账单以及当前 PAT 的账号绑定。

### 处理流程

先判断用户意图和业务对象，再进入对应分支。

#### 查询

- 用户信息、账户本位币、VIP 状态或写入额度：使用 `get_user_info`
- 账本：使用 `list_books`，已知名称片段时用不区分大小写的 `nameKeyword` 缩小范围
- 资产：使用 `list_assets`，已知名称片段时用不区分大小写的 `nameKeyword` 缩小范围，默认不返回余额和信用额度，只有用户明确要求查看余额或额度时才设 `includeBalances=true`
- 借入或借出详情：使用 `list_debt_accounts`，`list_assets` 可能包含 type 5 债务记录基础资产条目，但不能替代详细信息，不要自行聚合两类响应
- 分类：使用 `list_categories`
- 分类图标：使用 `list_category_icons`
- 删除分类的影响评估：使用 `check_category_deletion` 取得受影响账单数量
- 标签：使用 `list_tags`
- 账单批量盘点、查重或只读对账：使用 `list_bills`，`remarkKeyword` 按不区分大小写的字面子串匹配，需要完整筛选范围时继续翻页到 `nextCursor=null`
- 共享账本按成员筛选：先使用 `list_book_members` 取得成员 ID，再传给 `list_bills.memberIds` 或 `get_bill_statistics.memberIds`
- 收支、报销、退款、分类、成员或时间趋势统计：使用 `get_bill_statistics`，`currency` 币种标识同时筛选原始记账币种并指定统计结果币种，省略时不筛选原始币种并按当前本位币汇总
  - 无论是否传入 `currency`，都直接使用固定返回结构，不自行发明 `groupBy`
- 预算使用情况：使用 `get_budget`，省略 `period` 时查询按账本月份起始日确定的当前月，只有用户需要逐日支出、累计支出或预算趋势时才设 `includeDailyStatistics=true`
- 设置预算：使用 `set_budget`，必须明确账本、月份或年份及总预算/分类目标；一次只改一项，其他额度保持，金额 0 清除此项额度。仅在用户授权范围内设置。实际总额度可能由分类额度之和决定，用 `get_budget` 核对；写入结果未确认时先回读，不盲目重试。避免与 App 同时编辑预算
- 批量判断转账方向：直接使用 `list_bills` 摘要的 `fromId`/`targetId`，需要显示资产名称时只调用一次 `list_assets` 建立 ID 映射
- 列表字段无歧义时直接使用结果，不要逐条调用 `get_bill`，只有重复或近似候选、关系冲突、摘要缺失字段或用户要求完整记录时才使用，写入成功后直接使用写入工具返回的完整账单
- 用户需要核对账单附件时，使用 `get_bill` 返回的 `imageUrls` 按需读取图片，无图片时为空数组
- 同时核实多笔详情时使用 `get_bills`，需要确认 App 改动时传 `refresh: true` 先同步账单，缓存读取时间不代表同步时间，最近同步时间未知时为 null
  - 图片地址属于私人账单资料，不发送给无关第三方，读取 CDN 时不要附带 MCP PAT 或钱迹登录凭据
  - 服务仅返回地址，不下载图片或执行 OCR，客户端没有图像读取能力时应说明限制

#### 创建或修改

需要账本、资产、分类或标签 ID 且当前缺少可信 ID 时，只调用对应的 `list_books`、`list_assets`、`list_categories` 或 `list_tags` 获取，不得猜测或构造 ID。

- 普通收支：创建使用 `create_bills` 的 `bills`，修改使用 `update_bills` 的 `updates`，即使只操作一笔，也传入只有一项的列表，修改按 `billId` 定位原账单，不传 `type`，只在用户要求时通过 `reimbursable` 切换普通支出与待报销支出
- 转账或信用卡还款：创建使用 `create_transfer`，修改使用 `update_transfer`，修改按 `billId` 定位单笔账单，只在用户要求改变场景时传 `creditRepayment`，同一次修改可以同时提交最终场景、金额和双边资产
- 退款：创建使用 `create_refund`，修改使用 `update_refund`，修改按 `refundBillId` 定位单笔退款，不传源账单 ID
- 报销：创建使用 `reimburse_bills`，只传源账单列表和本次总金额，单条报销入账删除使用 `delete_reimbursement`，按源账单取消全部报销关系使用 `cancel_reimbursements`
  1. 首次调用提示迁移新版报销时，告知用户迁移后旧版本将不能继续使用报销
  2. 取得明确同意后，用相同业务参数将 `confirmReimbursementUpgrade` 设为 `true` 重试
  3. 不得预先同意，服务器只在钱迹明确要求时迁移并只重试一次
  4. 迁移完成但报销失败时，只处理失败原因，不得再次迁移

退款和报销必须使用专用工具，不得自行构造账单关联关系。

- 分类：创建一级分类使用 `create_categories`，批量创建子分类使用 `create_subcategories`，改名使用 `update_categories`，移动或调整层级使用 `move_category`，重排顺序使用 `reorder_categories`
- 标签：创建使用 `create_tags`，创建标签组使用 `create_tag_groups`，改名、移动分组或改色使用 `update_tags`，重排标签使用 `reorder_tags`，重排标签组使用 `reorder_tag_groups`

需要主动登录或重新登录当前钱迹账号时，使用 `connect_qianji` 获取一次性链接，未解绑的重新登录只能使用当前已连接的钱迹账号。

#### 删除或取消

按照对应工具说明取得用户确认后再调用：

- 一笔或多笔普通收支、待报销支出、转账或还款：使用 `delete_bills` 的 `deletions`，存在关联时只在用户确认完整删除范围后，将对应项 `cascadeRelatedBills` 设为 `true`
- 单笔退款：使用 `delete_refund` 的 `refundBillId`
- 单笔报销入账：使用 `delete_reimbursement` 的 `reimbursementBillId`
- 取消一笔或多笔源账单的全部报销关系：使用 `cancel_reimbursements` 的 `sourceBillIds`，保留源账单并删除其报销入账子账单，不得传报销入账子账单 ID
- 分类：使用 `delete_categories` 的 `deletions`，可选择把账单转移到其他分类或连同账单一起删除
  - 转移目标不能是本批次待删除分类；不得同时指定转移账单和删除账单。操作后调用 `refresh_cache`，再核对受影响账单、统计和资产余额
  - `deleteBills=true` 会删除账单，但此接口不回滚资产余额，刷新缓存也不会修复差额。若用户需要撤销账单对余额的影响，先用 `delete_bills` 删除已确认范围的账单并核对余额，再删除空分类。不得擅自创建抵扣账单来补余额
  - 父分类仍有子分类时服务端会拒绝删除；须先确认子分类的处理方式
  - 非空分类必须指定 `transferTo` 或选择 `deleteBills=true`，不能通过省略两者来保留无分类账单
- 标签：使用 `delete_tags` 的 `tagIds`，删除标签组使用 `delete_tag_groups` 的 `groupIds`，保留标签但不再使用可改用 `archive_tags` 的 `tagIds` 归档
  - 删除标签组会把组内标签移到默认组，不会删除这些标签；`list_tags` 暂不显示空标签组
- 当前 PAT 的钱迹账号绑定：使用 `disconnect_qianji`，账号未被其他 PAT 使用时会删除全部本地数据，不会删除钱迹云端数据

完成当前用户请求所需的全部调用后，将最终结果交付用户并结束本次操作。

### 异常恢复

- PAT 未绑定钱迹账号或钱迹登录状态失效时：
  1. 将客户端返回的 10 分钟一次性连接链接原样交给用户，并提醒在 10 分钟内登录
  2. 先提供可点击的 Markdown 链接，再在下一段附上未省略、未转义的完整原始 URL，供内置浏览器拦截时复制到系统浏览器，不得只提供其中一种
  3. 首次连接填写钱迹账号和密码，未解绑的重新登录只填写密码，完成连接后重试原操作
  4. 除上述两种完整链接形式外，不得索取、提取或复述账号、密码、PAT 或链接中的一次性 `ticket`
- 需要确认钱迹最新状态时，调用 `refresh_cache` 刷新用户、账单及全部目录缓存，包含币种目录，若收到 `WRITE_CONFIRMATION_FAILED`，远端写入可能已经生效，刷新后查询相关账单，仍无法确认时停止并告知用户，不得自动重试原写入
- 批量写入收到 `WRITE_PARTIAL` 时，按错误中的输入序号确认每一项结果，成功项已经写入，不得重试，只处理冲突或未确认项
  - 分类或标签批量写入的序号从 1 开始：`completed` 已完成，`unconfirmed` 结果未知，`notAttempted` 未执行；未确认不等于失败，须查询核对后才能决定是否补做，不得重试整个批次。缓存清理失败时先调用 `refresh_cache`

### 数据约定

- 账单、账本、分类和资产 ID 使用 Java `long` 正数范围内的十进制字符串，`"-1"` 和 `"0"` 只能在具体字段明确允许时使用
- 标签和成员 ID 使用对应查询返回的原始字符串，不得按数值 ID 猜测或改写
- 金额使用币种主单位，不使用分、美分等最小货币单位
- `money`、`fee` 和 `discount` 的业务含义以工具字段说明为准，输入结构约束以 Schema 为准
- 服务端自动换算时，汇率按 HALF_UP 保留 10 位，换算金额按 HALF_EVEN 保留 2 位
- 跨币种账单使用 `get_user_info.baseCurrency` 解释本位币，读取历史账单时使用 `currencyConversion` 的保存值，不用当前汇率重算

### 官方 AI 建议

- 需要让官方 AI 判断分类或资产时调用 `emma_classify` 传入一句话，小票或截图文本用 `emma_ocr`，两者都只返回建议不写入账单
- 建议结果里的分类、子分类和资产名称需与当前目录核对，金额缺失或与用户描述不一致时先向用户确认，再调用 `create_bills` 落账

### 显式启用的本机恢复

恢复工具仅在配置私人绝对路径 `QIANJI_MCP_RECOVERY_ROOT` 后可用。资产关联、借贷和报销重建默认预览；分类、余额和临时钱包清理直接执行，须先核实授权及预期当前状态。`recover_asset_bills` 只替换已删除资产的现存普通账单引用，保留原编号、图片和关系。备份仅只读访问当前账号，缺失转账/还款须明确允许新编号恢复，保留原交易日期、金额和附件，编号冲突或近似重复时停止。完全一致的已恢复记录跳过，不重复写入。旧退款使用专用退款工具，通用恢复拒绝利息类型，防止上游清空分类。

`rebuild_reimbursement` 仅在明确允许新编号后逐条执行，保护原支出、到账日期、备注、分类和图片，执行前保存私人回执。借贷起始记录必须使用 `recover_debt_wallet`，即使账单已经指向新钱包，也要恢复并核验借贷资产的资金账户、原编号、结清状态和图片，通用关联工具会拒绝此类记录。`restore_bill_category` 恢复有依据的原分类并检查预期当前分类，兼容的普通支出请求方式须单独获准，最终回读可能保留原利息类型。

`restore_asset_balance` 仅用于有依据且明确授权的余额恢复，带 expectedBalance 防止覆盖后续变动，不生成抵扣账单，不用它掩盖未解释差额。`discard_unused_wallet` 只清理本次恢复产生、明确授权且无账单关联的临时钱包，须核实预期余额。写后刷新核对原字段和全部受影响余额，部分失败先查私人回执与实际状态，禁止重放整批。`refresh_cache.fullBillSync` 仅重建本地账单缓存，不修改云端账单。
