import { minio, ATTACH_BUCKET } from '../libs/minio';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function createPresignedPut(orderId: number, mime: string) {
  const ext = mime.split('/')[1] || 'bin';
  const objectName = `${orderId}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const policy = await minio.presignedPutObject(ATTACH_BUCKET, objectName, 60 * 10); // 10 min
  return { url: policy, objectName };
}

export async function saveAttachment(orderId: number, objectName: string, type: 'photo'|'video'|'doc', meta?: any) {
  const url = `/${ATTACH_BUCKET}/${objectName}`; // через Nginx/minio-nginx либо прямой путь
  return prisma.attachment.create({ data: { orderId, type, url, meta } });
}

const bucketName = process.env.MINIO_BUCKET || 'attachments';

// Multer configuration for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_DOCUMENT_TYPES];
    if (allowedTypes.includes(file.mimetype as any)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not supported`));
    }
  }
}).array('files', 10); // Max 10 files per request

export class AttachmentsService {
  /**
   * Initialize MinIO bucket if it doesn't exist
   */
  async initializeBucket(): Promise<void> {
    try {
      const exists = await minioClient.bucketExists(bucketName);
      if (!exists) {
        await minioClient.makeBucket(bucketName);
        logger.info(`Created MinIO bucket: ${bucketName}`);
        
        // Set public read policy for attachments
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${bucketName}/*`]
            }
          ]
        };
        
        await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy));
        logger.info(`Set public read policy for bucket: ${bucketName}`);
      }
    } catch (error) {
      logger.error('Failed to initialize MinIO bucket', { 
        bucket: bucketName, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Upload files to order
   */
  async uploadOrderAttachments(req: Request, res: Response): Promise<void> {
    const { orderId } = req.params;

    try {
      // Verify order exists and user has access
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { client: true }
      });

      if (!order) {
        res.status(404).json({ 
          error: 'ORDER_NOT_FOUND', 
          message: 'Order not found' 
        });
        return;
      }

      // TODO: Add proper authorization check
      // if (req.user.id !== order.clientId && !req.user.roles.includes('ADMIN')) {
      //   res.status(403).json({ error: 'FORBIDDEN' });
      //   return;
      // }

      // Use multer to handle file upload
      upload(req, res, async (err) => {
        if (err) {
          logger.error('File upload error', { orderId, error: err.message });
          res.status(400).json({ 
            error: 'UPLOAD_ERROR', 
            message: err.message 
          });
          return;
        }

        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
          res.status(400).json({ 
            error: 'NO_FILES', 
            message: 'No files provided' 
          });
          return;
        }

        try {
          const uploadedAttachments = [];

          for (const file of files) {
            const attachment = await this.processFileUpload(file, orderId);
            uploadedAttachments.push(attachment);
          }

          logger.info('Files uploaded successfully', {
            orderId,
            fileCount: uploadedAttachments.length,
            attachmentIds: uploadedAttachments.map(a => a.id)
          });

          res.status(201).json({
            success: true,
            data: uploadedAttachments,
            message: `Uploaded ${uploadedAttachments.length} file(s)`
          });

        } catch (error) {
          logger.error('File processing error', { 
            orderId, 
            error: error instanceof Error ? error.message : String(error) 
          });
          res.status(500).json({ 
            error: 'PROCESSING_ERROR', 
            message: 'Failed to process uploaded files' 
          });
        }
      });

    } catch (error) {
      logger.error('Upload endpoint error', { 
        orderId, 
        error: error instanceof Error ? error.message : String(error) 
      });
      res.status(500).json({ 
        error: 'INTERNAL_ERROR', 
        message: 'Internal server error' 
      });
    }
  }

  /**
   * Process individual file upload
   */
  private async processFileUpload(file: Express.Multer.File, orderId: string): Promise<any> {
    const fileId = uuidv4();
    const fileExtension = path.extname(file.originalname);
    const fileName = `${fileId}${fileExtension}`;
    const objectPath = `orders/${orderId}/${fileName}`;

    // Upload to MinIO
    await minioClient.putObject(
      bucketName,
      objectPath,
      file.buffer,
      file.size,
      {
        'Content-Type': file.mimetype,
        'X-Amz-Meta-Original-Name': file.originalname,
        'X-Amz-Meta-Upload-Date': new Date().toISOString()
      }
    );

    // Determine attachment type
    const attachmentType = this.getAttachmentType(file.mimetype);

    // Save to database
    const attachment = await prisma.attachment.create({
      data: {
        id: fileId,
        orderId,
        fileName: file.originalname,
        filePath: objectPath,
        fileSize: file.size,
        mimeType: file.mimetype,
        type: attachmentType,
        uploadedAt: new Date()
      }
    });

    // Generate public URL
    const publicUrl = `${process.env.MINIO_PUBLIC_URL || 'http://localhost:9000'}/${bucketName}/${objectPath}`;

    return {
      id: attachment.id,
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType,
      type: attachment.type,
      url: publicUrl,
      uploadedAt: attachment.uploadedAt
    };
  }

  /**
   * Get order attachments
   */
  async getOrderAttachments(req: Request, res: Response): Promise<void> {
    const { orderId } = req.params;

    try {
      const attachments = await prisma.attachment.findMany({
        where: { orderId },
        orderBy: { uploadedAt: 'desc' }
      });

      const attachmentsWithUrls = attachments.map(attachment => ({
        id: attachment.id,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        mimeType: attachment.mimeType,
        type: attachment.type,
        url: `${process.env.MINIO_PUBLIC_URL || 'http://localhost:9000'}/${bucketName}/${attachment.filePath}`,
        uploadedAt: attachment.uploadedAt
      }));

      res.json({
        success: true,
        data: attachmentsWithUrls
      });

    } catch (error) {
      logger.error('Failed to get attachments', { 
        orderId, 
        error: error instanceof Error ? error.message : String(error) 
      });
      res.status(500).json({ 
        error: 'INTERNAL_ERROR', 
        message: 'Failed to get attachments' 
      });
    }
  }

  /**
   * Delete attachment
   */
  async deleteAttachment(req: Request, res: Response): Promise<void> {
    const { orderId, attachmentId } = req.params;

    try {
      const attachment = await prisma.attachment.findFirst({
        where: { 
          id: attachmentId,
          orderId 
        }
      });

      if (!attachment) {
        res.status(404).json({ 
          error: 'ATTACHMENT_NOT_FOUND', 
          message: 'Attachment not found' 
        });
        return;
      }

      // Delete from MinIO
      await minioClient.removeObject(bucketName, attachment.filePath);

      // Delete from database
      await prisma.attachment.delete({
        where: { id: attachmentId }
      });

      logger.info('Attachment deleted', { 
        orderId, 
        attachmentId, 
        fileName: attachment.fileName 
      });

      res.json({
        success: true,
        message: 'Attachment deleted successfully'
      });

    } catch (error) {
      logger.error('Failed to delete attachment', { 
        orderId, 
        attachmentId, 
        error: error instanceof Error ? error.message : String(error) 
      });
      res.status(500).json({ 
        error: 'INTERNAL_ERROR', 
        message: 'Failed to delete attachment' 
      });
    }
  }

  /**
   * Generate presigned URL for direct upload (alternative method)
   */
  async generatePresignedUrl(req: Request, res: Response): Promise<void> {
    const { orderId } = req.params;
    const { fileName, contentType } = req.body;

    try {
      if (!fileName || !contentType) {
        res.status(400).json({ 
          error: 'MISSING_PARAMS', 
          message: 'fileName and contentType are required' 
        });
        return;
      }

      const allowedTypes = [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_DOCUMENT_TYPES];
      if (!allowedTypes.includes(contentType)) {
        res.status(400).json({ 
          error: 'INVALID_FILE_TYPE', 
          message: `File type ${contentType} not supported` 
        });
        return;
      }

      const fileId = uuidv4();
      const fileExtension = path.extname(fileName);
      const objectPath = `orders/${orderId}/${fileId}${fileExtension}`;

      // Generate presigned URL (expires in 10 minutes)
      const presignedUrl = await minioClient.presignedPutObject(
        bucketName,
        objectPath,
        10 * 60 // 10 minutes
      );

      res.json({
        success: true,
        data: {
          uploadUrl: presignedUrl,
          objectPath,
          fileId,
          expiresIn: 600 // seconds
        }
      });

    } catch (error) {
      logger.error('Failed to generate presigned URL', { 
        orderId, 
        error: error instanceof Error ? error.message : String(error) 
      });
      res.status(500).json({ 
        error: 'INTERNAL_ERROR', 
        message: 'Failed to generate upload URL' 
      });
    }
  }

  /**
   * Determine attachment type from MIME type
   */
  private getAttachmentType(mimeType: string): string {
    if (SUPPORTED_IMAGE_TYPES.includes(mimeType as any)) {
      return 'PHOTO';
    } else if (mimeType.startsWith('video/')) {
      return 'VIDEO';
    } else if (SUPPORTED_DOCUMENT_TYPES.includes(mimeType as any)) {
      return 'DOCUMENT';
    }
    return 'OTHER';
  }

  /**
   * Clean up orphaned files (utility method)
   */
  async cleanupOrphanedFiles(): Promise<void> {
    try {
      // Find files in MinIO that don't have database records
      const objectsList: any[] = [];
      const objectsStream = minioClient.listObjectsV2(bucketName, 'orders/', true);
      
      for await (const obj of objectsStream) {
        objectsList.push(obj);
      }

      const dbAttachments = await prisma.attachment.findMany({
        select: { filePath: true }
      });

      const dbPaths = new Set(dbAttachments.map(a => a.filePath));
      const orphanedFiles = objectsList.filter(obj => !dbPaths.has(obj.name));

      if (orphanedFiles.length > 0) {
        logger.info(`Found ${orphanedFiles.length} orphaned files, cleaning up...`);
        
        for (const file of orphanedFiles) {
          await minioClient.removeObject(bucketName, file.name);
        }
        
        logger.info(`Cleaned up ${orphanedFiles.length} orphaned files`);
      }

    } catch (error) {
      logger.error('Failed to cleanup orphaned files', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }
}