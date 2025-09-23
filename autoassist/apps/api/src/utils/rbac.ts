export type Role = 'admin' | 'service_manager' | 'dispatcher' | 'mechanic' | 'customer';

export const canReadOrder = (role: Role, userId: number, orderClientId?: number) => {
  if (['admin','service_manager','dispatcher','mechanic'].includes(role)) return true;
  if (role === 'customer' && orderClientId && orderClientId === userId) return true;
  return false;
};

export const canWriteAttachment = (role: Role, userId: number, orderClientId?: number) => {
  if (['admin','service_manager','dispatcher','mechanic'].includes(role)) return true;
  if (role === 'customer' && orderClientId && orderClientId === userId) return true;
  return false;
};
