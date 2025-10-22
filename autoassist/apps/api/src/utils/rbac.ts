// src/utils/rbac.ts

/** Роли в системе */
export type Role = 'admin' | 'service_manager' | 'dispatcher' | 'mechanic' | 'customer';

/** Базовые пермишены (на будущее) */
export type Permission =
  | 'order:read'
  | 'order:write'
  | 'order:status:update'
  | 'attachment:read'
  | 'attachment:write'
  | 'estimate:write'
  | 'payment:create'
  | 'notification:broadcast';

/** Матрица ролей -> набор прав (можно расширять централизованно) */
const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set<Permission>([
    'order:read',
    'order:write',
    'order:status:update',
    'attachment:read',
    'attachment:write',
    'estimate:write',
    'payment:create',
    'notification:broadcast',
  ]),
  service_manager: new Set<Permission>([
    'order:read',
    'order:write',
    'order:status:update',
    'attachment:read',
    'attachment:write',
    'estimate:write',
    'payment:create',
  ]),
  dispatcher: new Set<Permission>([
    'order:read',
    'order:write',
    'order:status:update',
    'attachment:read',
    'attachment:write',
    'payment:create',
  ]),
  mechanic: new Set<Permission>([
    'order:read',
    // чаще всего механик не меняет статус произвольно
    'attachment:read',
    'attachment:write',
  ]),
  customer: new Set<Permission>([
    'order:read',
    'attachment:read',
    'attachment:write', // для загрузки фото/документов по своему заказу
  ]),
};

/** Хэлпер: у роли есть общий пермишен? */
export function hasPermission(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(perm) ?? false;
}

/** Хэлпер: роль «повышенная» (персонал сервиса) */
export function isStaff(role: Role): boolean {
  return role === 'admin' || role === 'service_manager' || role === 'dispatcher' || role === 'mechanic';
}

/** ---- Твои drop-in функции, совместимые по сигнатурам ---- */

/**
 * Может ли пользователь читать заказ?
 * Персонал сервиса — всегда; клиент — только свой заказ.
 */
export const canReadOrder = (role: Role, userId: number, orderClientId?: number) => {
  if (isStaff(role)) return true;
  if (role === 'customer' && orderClientId && orderClientId === userId) return true;
  return false;
};

/**
 * Может ли пользователь писать/загружать вложения для заказа?
 * Персонал сервиса — всегда; клиент — только для своего заказа.
 */
export const canWriteAttachment = (role: Role, userId: number, orderClientId?: number) => {
  if (isStaff(role)) return true;
  if (role === 'customer' && orderClientId && orderClientId === userId) return true;
  return false;
};

/** ---- Дополнительные точечные проверки (опционально, для удобства в коде) ---- */

/** Может ли менять статус заказа? (клиент — нет, персонал — да; при желании сузить логику по статусам) */
export function canUpdateOrderStatus(role: Role): boolean {
  return hasPermission(role, 'order:status:update');
}

/** Может ли создавать инвойсы/платежи от лица сервиса */
export function canCreatePayment(role: Role): boolean {
  return hasPermission(role, 'payment:create');
}

/** Может ли редактировать смету */
export function canWriteEstimate(role: Role): boolean {
  return hasPermission(role, 'estimate:write');
}

/** Может ли рассылать широковещательные уведомления */
export function canBroadcastNotifications(role: Role): boolean {
  return hasPermission(role, 'notification:broadcast');
}

/** Утверждающий вариант — удобно в сервисах/роутах */
export function assertCan(condition: boolean, code = 'FORBIDDEN') {
  if (!condition) {
    const err: any = new Error(code);
    err.status = 403;
    err.code = code;
    throw err;
  }
}

/** Пример: владелец ли заказа текущий юзер */
export function isOwner(userId: number | null | undefined, orderClientId?: number | null): boolean {
  return Boolean(userId && orderClientId && Number(userId) === Number(orderClientId));
}
