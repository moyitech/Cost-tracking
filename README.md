# Cost Tracking
物品成本计算器

# 产品需求文档 (PRD)

## 1. 产品概述
Cost Tracking 是一款基于前后端分离架构的Web应用，帮助用户记录购买物品信息并自动计算其日均使用成本的工具。采用FastAPI作为后端框架，提供高性能的API服务；前端使用现代Web技术构建，所有数据采用线上存储，支持用户跨设备访问，让用户能够清晰了解每件物品的实际使用价值，辅助用户进行更明智的消费决策和个人财务管理。

## 2. 产品目标
- 提供简单直观的前端界面，方便用户快速记录购买物品信息
- 基于FastAPI构建高性能后端API，提供稳定可靠的数据处理服务
- 自动计算每件物品的日均使用成本，帮助用户了解物品的实际使用价值
- 通过数据可视化呈现统计信息，让用户全面了解个人物品投资情况
- 支持数据线上云存储，确保用户数据安全且支持跨设备访问
- 提供舒适的使用体验，支持深色/浅色模式切换
- 确保前后端分离架构的高可维护性和可扩展性

## 3. 核心功能

### 3.1 物品记录管理
- **添加物品记录**：用户通过前端界面录入物品信息，前端调用后端API将数据存储到云端数据库
- **删除物品记录**：用户可删除不需要的物品记录，操作通过API调用实现
- **云端数据存储**：所有记录通过FastAPI后端存储至云端数据库，支持用户跨设备访问和数据同步
- **数据验证**：前后端双重验证，确保数据完整性和安全性

### 3.2 成本计算
- **后端自动计算日均成本**：FastAPI后端根据购买日期和当前日期自动计算物品已使用天数，并根据购买金额计算日均使用成本（日均成本 = 购买金额 ÷ 使用天数）
- **实时数据更新**：前端通过API轮询或WebSocket获取最新数据，每当添加或删除物品记录时，系统自动重新计算相关数据
- **批量计算支持**：后端支持批量处理多条记录的成本计算

### 3.3 数据统计与展示
- **物品列表展示**：前端通过API获取数据，以列表形式展示所有已添加物品记录，每条记录包含物品名称、购买日期、购买金额、使用天数和日均成本
- **物品统计汇总**：后端API计算并返回物品总数、总成本和日均总成本等关键统计数据
- **时间排序**：支持多种排序方式（按购买日期、按成本、按使用天数等），默认按照购买日期倒序排列
- **数据分页**：支持大量数据的分页加载，提升前端性能
- **搜索过滤**：支持按物品名称、日期范围等条件过滤数据

### 3.4 用户认证功能
- **微信扫码登录**：使用微信扫码一键登录，无需记住密码，提升用户体验
- **自动用户注册**：首次微信登录自动创建用户账户，简化注册流程
- **安全认证**：采用JWT Token进行身份认证，支持Token刷新机制
- **登录状态保持**：安全的登录状态管理，自动处理Token过期
- **微信信息同步**：自动获取用户微信昵称和头像作为用户信息

### 3.5 用户体验功能
- **主题切换**：支持深色模式和浅色模式切换，主题偏好保存在浏览器本地存储中，无需后端交互
- **前后端双重表单验证**：前端进行实时验证，后端进行最终验证，确保数据有效性
- **操作反馈**：提供明确的视觉和文字反馈，包括API请求状态的反馈
- **响应式设计**：前端采用响应式设计，适配不同屏幕尺寸的设备
- **加载状态**：API请求时显示加载状态，提升用户体验
- **错误处理**：完善的错误处理机制，包括网络错误、服务器错误等的用户友好提示
- **二维码状态管理**：微信登录二维码的生成、刷新和状态监控
- **本地存储优化**：主题等前端偏好设置使用localStorage，减少不必要的API请求

## 4. 技术架构

### 4.1 整体架构
- **前端架构**：采用现代前端框架（React/Vue.js），构建单页应用（SPA）
- **后端架构**：基于Python FastAPI框架，提供高性能异步RESTful API服务
- **数据存储层**：采用PostgreSQL 14+作为主数据库，利用其ACID特性确保数据一致性
- **缓存层**：Redis用于存储会话数据和提升热点数据访问性能
- **部署架构**：前后端分离部署，支持Docker容器化和云原生部署
- **数据安全**：PostgreSQL提供企业级数据安全特性，支持SSL连接和数据加密

### 4.2 前端技术栈
- **框架**：React.js 或 Vue.js 3
- **状态管理**：Redux Toolkit 或 Vuex
- **UI组件库**：Ant Design 或 Element Plus
- **HTTP客户端**：Axios
- **二维码组件**：qrcode.js 或 vue-qr
- **定时器管理**：用于轮询微信登录状态
- **构建工具**：Vite 或 Webpack
- **样式方案**：CSS Modules 或 Styled Components

### 4.3 后端技术栈
- **框架**：FastAPI
- **数据库**：PostgreSQL 14+
- **ORM**：SQLAlchemy 2.0
- **认证授权**：JWT Token
- **微信登录**：微信开放平台OAuth 2.0
- **API文档**：自动生成Swagger/OpenAPI文档
- **数据验证**：Pydantic模型
- **缓存**：Redis（用于存储微信登录会话）
- **二维码生成**：qrcode库
- **数据库驱动**：psycopg2 或 asyncpg（异步支持）

### 4.4 API设计
- **RESTful风格**：遵循REST设计原则
- **统一响应格式**：标准化的API响应结构
- **错误处理**：完善的错误码和错误信息
- **版本控制**：支持API版本管理
- **分页支持**：列表接口支持分页查询

### 4.5 PostgreSQL数据库设计
**数据库版本**：PostgreSQL 14+（支持JSON字段、生成列等高级特性）

**核心表设计**：
- **用户表(users)**：通过微信登录创建的用户信息
  ```sql
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    openid VARCHAR(128) UNIQUE NOT NULL,
    unionid VARCHAR(128),
    nickname VARCHAR(255),
    avatar_url TEXT,
    is_delete BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
  ```

- **物品表(items)**：存储用户添加的物品记录
  ```sql
  CREATE TABLE items (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    purchase_date DATE NOT NULL,
    purchase_amount DECIMAL(10,2) NOT NULL,
    daily_cost DECIMAL(10,4) GENERATED ALWAYS AS (purchase_amount / GREATEST(1, CURRENT_DATE - purchase_date)) STORED,
    is_delete BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
  ```

- **用户配置表(user_preferences)**：存储用户偏好设置（预留扩展）
  ```sql
  CREATE TABLE user_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL,
    is_delete BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
  ```

- **微信登录会话表(wechat_sessions)**：临时存储微信登录会话
  ```sql
  CREATE TABLE wechat_sessions (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(128) UNIQUE NOT NULL,
    state VARCHAR(128) NOT NULL,
    user_info JSONB,
    status VARCHAR(20) DEFAULT 'pending',
    is_delete BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
  );
  ```

**索引优化**：
- `CREATE UNIQUE INDEX idx_users_openid ON users(openid) WHERE is_delete = FALSE;`
- `CREATE INDEX idx_items_user_id ON items(user_id) WHERE is_delete = FALSE;`
- `CREATE INDEX idx_items_purchase_date ON items(purchase_date DESC) WHERE is_delete = FALSE;`
- `CREATE INDEX idx_wechat_sessions_session_id ON wechat_sessions(session_id) WHERE is_delete = FALSE;`
- `CREATE INDEX idx_wechat_sessions_expires_at ON wechat_sessions(expires_at) WHERE is_delete = FALSE;`
- `CREATE INDEX idx_user_preferences_user_id ON user_preferences(user_id) WHERE is_delete = FALSE;`
- `CREATE INDEX idx_items_user_delete ON items(user_id, is_delete);`
- `CREATE INDEX idx_users_delete ON users(is_delete);`

**PostgreSQL特性利用**：
- **生成列**：自动计算日均成本
- **JSONB**：存储微信用户信息的灵活结构
- **时区感知**：所有时间字段使用TIMESTAMP WITH TIME ZONE
- **软删除机制**：通过is_delete字段实现数据软删除，保留数据完整性
- **部分索引**：为未删除数据创建高效索引，提升查询性能
- **数据完整性**：应用层逻辑控制数据关联，避免外键约束带来的性能影响

## 5. 用户界面描述

### 5.1 整体布局
- 顶部导航栏：显示应用名称、简短描述和主题切换按钮
- 主要内容区：分为物品添加表单和物品列表展示两个主要部分
- 页脚：显示版权信息

### 5.2 物品添加表单
- 物品名称输入框：允许用户输入物品名称，支持实时验证
- 购买日期选择器：提供日期选择功能，限制不能选择未来日期
- 购买金额输入框：允许用户输入物品购买金额，支持数值验证
- 添加按钮：提交表单数据，通过API调用添加新物品记录
- 加载状态：提交时显示加载状态，防止重复提交

### 5.3 物品列表与统计
- 统计信息卡片：实时展示物品总数、总成本和日均总成本（数据从API获取）
- 物品记录卡片：每条记录显示物品名称、购买日期、购买金额、使用天数和日均成本
- 删除按钮：每条记录旁提供删除功能，删除时需要确认
- 空状态提示：当没有物品记录时，显示友好的提示信息
- 搜索过滤：提供搜索框和过滤选项，帮助用户快速查找特定物品
- 分页控制：当数据量大时，提供分页导航

### 5.4 登录页面界面
- **简洁登录页面**：只提供微信扫码登录方式，界面简洁明了
- **微信扫码区域**：二维码显示区域，包含应用名称和登录提示
- **登录引导**：显示"请使用微信扫描二维码登录"的提示信息
- **登录状态反馈**：二维码加载状态、扫码成功提示、登录成功跳转
- **二维码刷新**：自动检测二维码过期，提供手动刷新选项

### 5.5 交互元素
- 主题切换按钮：点击可切换深色/浅色模式，状态保存在浏览器本地存储
- 表单提交按钮：添加物品记录，集成API调用
- 删除按钮：删除物品记录，支持批量删除
- 加载指示器：所有API请求时显示加载状态
- 错误提示：网络错误或服务器错误时的用户友好提示
- 二维码刷新按钮：当二维码过期时用户可手动刷新
- 登录状态指示：实时显示微信扫码登录的各个状态阶段

## 6. API接口设计

### 6.1 用户认证接口
- `GET /api/auth/wechat/qr` - 获取微信登录二维码
- `POST /api/auth/wechat/callback` - 微信登录回调处理
- `GET /api/auth/wechat/status/{session_id}` - 查询微信登录状态
- `POST /api/auth/refresh` - 刷新Token
- `POST /api/auth/logout` - 用户登出

### 6.2 物品管理接口
- `GET /api/items` - 获取物品列表（支持分页、排序、过滤）
- `POST /api/items` - 创建新物品记录
- `GET /api/items/{id}` - 获取单个物品详情
- `PUT /api/items/{id}` - 更新物品记录
- `DELETE /api/items/{id}` - 删除物品记录
- `DELETE /api/items/batch` - 批量删除物品记录

### 6.3 统计数据接口
- `GET /api/stats/overview` - 获取总体统计数据
- `GET /api/stats/trends` - 获取成本趋势数据

### 6.4 用户配置接口
- `GET /api/user/preferences` - 获取用户偏好设置（预留扩展）
- `PUT /api/user/preferences` - 更新用户偏好设置（预留扩展）

## 7. 用户交互流程

### 7.1 添加物品流程
1. 用户在物品名称输入框中输入物品名称（前端实时验证）
2. 用户在购买日期选择器中选择物品购买日期
3. 用户在购买金额输入框中输入物品购买金额（前端数值验证）
4. 用户点击"添加物品"按钮
5. 前端显示加载状态，阻止重复提交
6. 前端发送POST请求到后端API (`/api/items`)
7. 后端验证数据有效性，计算日均成本，将数据存储到数据库
8. 后端返回成功响应和新创建的物品数据
9. 前端更新本地状态，将新物品添加到列表
10. 前端更新统计数据（总数、总成本、日均总成本）
11. 表单自动清空，准备添加下一件物品
12. 系统显示添加成功的反馈提示

### 7.2 查看物品列表与统计流程
1. 用户进入应用后，前端自动发起API请求获取物品列表 (`/api/items`)
2. 后端从数据库查询用户的所有物品记录，按购买日期倒序返回
3. 前端同时请求统计数据 (`/api/stats/overview`)
4. 前端接收数据并渲染物品列表，显示每件物品的详细信息和日均成本
5. 前端显示统计信息（总数、总成本、日均总成本）
6. 用户可以使用搜索和过滤功能，触发新的API请求
7. 支持分页加载，用户滚动时自动加载更多数据

### 7.3 删除物品流程
1. 用户在物品列表中找到需要删除的物品记录
2. 用户点击该记录旁的删除按钮
3. 前端显示确认对话框
4. 用户确认删除后，前端发送DELETE请求到后端API (`/api/items/{id}`)
5. 后端从数据库中删除对应的物品记录
6. 后端返回成功响应
7. 前端更新本地状态，从列表中移除该物品记录
8. 前端重新计算并更新统计信息
9. 系统显示删除成功的反馈提示

### 7.4 切换主题流程
1. 用户点击顶部导航栏中的主题切换按钮
2. 前端立即切换应用的主题（深色/浅色）
3. 前端将主题偏好保存到浏览器本地存储（localStorage）
4. 用户下次访问应用时，前端自动从本地存储读取并应用主题偏好
5. 主题切换仅在前端完成，无需后端交互

### 7.5 微信扫码登录流程
1. 用户访问应用，前端检查本地是否有有效Token
2. 如果没有Token，重定向到微信登录页面
3. 前端自动请求后端获取微信登录二维码 (`/api/auth/wechat/qr`)
4. 后端生成包含state参数的微信登录URL和会话ID，返回给前端
5. 前端显示二维码和"请使用微信扫描二维码登录"提示
6. 用户使用微信扫描二维码
7. 微信跳转到后端回调地址 (`/api/auth/wechat/callback`)
8. 后端接收微信回调，获取用户信息，验证state参数
9. 后端根据openid查找用户：
   - 如果用户已存在：直接生成JWT Token，更新会话状态为成功
   - 如果用户不存在：自动创建新用户账户，生成JWT Token，更新会话状态为成功
10. 前端通过轮询 (`/api/auth/wechat/status/{session_id}`) 获取登录状态
11. 检测到登录成功后，前端获取JWT Token并保存到本地存储
12. 前端重定向到主页面，自动加载用户数据，主题偏好从本地存储读取
13. 如果二维码过期，系统自动刷新二维码，用户也可手动刷新

## 8. 浏览器兼容性要求
- 支持主流现代浏览器，包括但不限于：
  - Google Chrome（最新两个稳定版本）
  - Mozilla Firefox（最新两个稳定版本）
  - Apple Safari（最新两个稳定版本）
  - Microsoft Edge（最新两个稳定版本）
- 确保在不同浏览器中功能正常、界面显示一致