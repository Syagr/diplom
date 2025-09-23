// Telegram Bot specific types and interfaces

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  added_to_attachment_menu?: boolean;
  allows_write_to_pm?: boolean;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_forum?: boolean;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  date: number;
  chat: TelegramChat;
  text?: string;
  photo?: TelegramPhotoSize[];
  location?: TelegramLocation;
  contact?: TelegramContact;
  reply_to_message?: TelegramMessage;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramLocation {
  longitude: number;
  latitude: number;
  horizontal_accuracy?: number;
  live_period?: number;
  heading?: number;
  proximity_alert_radius?: number;
}

export interface TelegramContact {
  phone_number: string;
  first_name: string;
  last_name?: string;
  user_id?: number;
  vcard?: string;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
  web_app?: TelegramWebApp;
  switch_inline_query?: string;
  switch_inline_query_current_chat?: string;
}

export interface TelegramWebApp {
  url: string;
}

export interface TelegramInlineKeyboard {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramReplyKeyboardButton {
  text: string;
  request_contact?: boolean;
  request_location?: boolean;
  request_poll?: TelegramKeyboardButtonPollType;
  web_app?: TelegramWebApp;
}

export interface TelegramKeyboardButtonPollType {
  type?: 'quiz' | 'regular';
}

export interface TelegramReplyKeyboard {
  keyboard: TelegramReplyKeyboardButton[][];
  is_persistent?: boolean;
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  input_field_placeholder?: string;
  selective?: boolean;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  inline_message_id?: string;
  chat_instance: string;
  data?: string;
  game_short_name?: string;
}

// Bot session and state management
export interface BotSession {
  telegramId: number;
  state: BotState;
  data: Record<string, any>;
  lastActivity: Date;
  language: string;
}

export enum BotState {
  IDLE = 'IDLE',
  REGISTERING = 'REGISTERING',
  CREATING_ORDER = 'CREATING_ORDER',
  SELECTING_VEHICLE = 'SELECTING_VEHICLE',
  PROVIDING_LOCATION = 'PROVIDING_LOCATION',
  UPLOADING_PHOTOS = 'UPLOADING_PHOTOS',
  CONFIRMING_ORDER = 'CONFIRMING_ORDER',
  VIEWING_ORDERS = 'VIEWING_ORDERS',
  MAKING_PAYMENT = 'MAKING_PAYMENT'
}

export interface BotCommand {
  command: string;
  description: string;
  handler: string;
  scope?: 'private' | 'group' | 'all';
}

export interface BotMenuButton {
  text: string;
  action: string;
  icon?: string;
  webApp?: boolean;
}

export interface OrderCreationFlow {
  step: number;
  totalSteps: number;
  data: {
    vehicleId?: string;
    type?: string;
    description?: string;
    location?: TelegramLocation;
    photos?: string[];
    estimatedCost?: number;
    scheduledDate?: string;
  };
}

export interface BotNotification {
  telegramId: number;
  message: string;
  type: 'text' | 'photo' | 'document';
  keyboard?: TelegramInlineKeyboard | TelegramReplyKeyboard;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disablePreview?: boolean;
}

export interface WebAppData {
  data: string;
  button_text: string;
}

export interface WebAppUser extends TelegramUser {
  photo_url?: string;
}

export interface WebAppInitData {
  query_id?: string;
  user?: WebAppUser;
  receiver?: WebAppUser;
  chat?: TelegramChat;
  start_param?: string;
  can_send_after?: number;
  auth_date: number;
  hash: string;
}

// Bot analytics and metrics
export interface BotMetrics {
  totalUsers: number;
  activeUsers: number;
  dailyActiveUsers: number;
  ordersCreated: number;
  completedOrders: number;
  averageSessionTime: number;
  mostUsedCommands: Array<{
    command: string;
    count: number;
  }>;
  userRetention: {
    day1: number;
    day7: number;
    day30: number;
  };
}