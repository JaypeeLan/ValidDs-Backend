/**
 * Response Message Enum
 * Standardized success response messages across the API
 */
export enum ResponseMessage {
  // Auth
  REGISTRATION_STARTED = 'Verification code sent to your email. Please check your inbox.',
  LOGIN_SUCCESS = 'You have been successfully logged in.',
  LOGOUT_SUCCESS = 'You have been successfully logged out.',
  PROFILE_RETRIEVED = 'Your profile has been retrieved.',

  // Products
  PRODUCT_RETRIEVED = 'Product retrieved successfully.',
  PRODUCTS_RETRIEVED = 'Products retrieved successfully.',
  PRODUCT_CREATED = 'Product created successfully.',
  PRODUCT_UPDATED = 'Product updated successfully.',
  PRODUCT_DELETED = 'Product deleted successfully.',

  // Creatives
  CREATIVE_RETRIEVED = 'Creative retrieved successfully.',
  CREATIVES_RETRIEVED = 'Creatives retrieved successfully.',
  CREATIVES_INGESTED = 'Creatives ingested successfully.',

  // Health
  HEALTH_OK = 'Service is healthy and running.',

  // Stores (Shopify)
  SHOPIFY_CONNECTED = 'Shopify store connected successfully.',
  SHOPIFY_DISCONNECTED = 'Shopify store disconnected successfully.',

  // Account
  ACCOUNT_CLOSED = 'Your account has been closed successfully.',
  PASSWORD_CHANGED = 'Your password has been changed successfully.',

  // Billing
  BILLING_HISTORY_RETRIEVED = 'Billing history retrieved successfully.',
  SUBSCRIPTION_CANCELLED = 'Subscription cancelled successfully.',
  SHOPIFY_PRODUCT_PUSHED = 'Product pushed to your Shopify store successfully.',

  // Generic
  SUCCESS = 'Operation completed successfully.',
  CREATED = 'Resource created successfully.',
  UPDATED = 'Resource updated successfully.',
  DELETED = 'Resource deleted successfully.',
}

/**
 * Standardized API response wrapper
 */
export function successResponse<T>(
  data: T,
  message: string,
  statusCode: number = 200,
): { success: true; message: string; statusCode: number; data: T } {
  return {
    success: true,
    message,
    statusCode,
    data,
  };
}
