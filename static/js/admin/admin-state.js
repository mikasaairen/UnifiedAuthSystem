/**
 * 管理控制台：共享状态与常量（须最先加载）
 */
let currentUser = null;
let isAdmin = false;
let myPermissionCodes = [];

/** 多标签组状态 */
var openTabs = [];
var activeTabId = null;
var tabIdCounter = 0;
var PAGE_TITLES = {
    workbench: '工作台',
    overview: '概览',
    usersList: '用户列表',
    approval: '注册审核',
    rolesList: '角色管理',
    permissions: '权限管理',
    resources: '资源管理',
    apps: '应用管理',
    logs: '审计日志',
    system: '系统设置',
    profile: '基本资料'
};

/** 子页面对应主页面（用于多标签下展示同一主页面不同 inner tab） */
var SUB_PAGE_MAIN = {
    usersList: 'users',
    approval: 'users',
    rolesList: 'roles',
    permissions: 'roles',
    resources: 'roles'
};

/** 各页面所需权限（用于权限变更后关闭无权限标签），null 表示无限制 */
var PAGE_PERMISSIONS = {
    workbench: null,
    overview: null,
    usersList: 'users:manage',
    approval: 'users:manage',
    rolesList: 'rbac:manage',
    permissions: 'rbac:manage',
    resources: 'rbac:manage',
    apps: 'apps:manage',
    logs: 'logs:view',
    system: ['users:manage', 'system:manage'],
    profile: null
};

/** 概览统计缓存（1 分钟内不重复请求） */
var overviewCache = { users: null, apps: null, roles: null, todayLogs: null, ts: 0 };
var OVERVIEW_CACHE_TTL = 60000;

/** 用户列表分页 */
var usersPageCurrent = 1;
var usersPageSize = 20;
var usersTotal = 0;

/** 日志列表分页 */
var logsPageCurrent = 1;
var logsPageSize = 20;
var logsTotal = 0;

/** 个人资料-会话列表分页 */
var sessionsPageCurrent = 1;
var sessionsPageSize = 10;
var sessionsAll = [];
var sessionsFilter = 'active';

let loginTrendChartInstance = null;
let actionPieChartInstance = null;
