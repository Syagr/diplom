export const toProxyUrl = (putUrl: string) =>
  putUrl
    .replace(/^https?:\/\/127\.0\.0\.1:12002/i, '/s3')
    .replace(/^https?:\/\/localhost:12002/i, '/s3')
    .replace(/^https?:\/\/127\.0\.0\.1:9000/i, '/s3')
    .replace(/^https?:\/\/localhost:9000/i, '/s3')
