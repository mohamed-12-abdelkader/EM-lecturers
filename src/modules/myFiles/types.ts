export interface FileCategoryRow {
  id: number;
  teacher_id: number;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export interface TeacherFileRow {
  id: number;
  teacher_id: number;
  name: string;
  description: string | null;
  file_url: string;
  file_key: string;
  file_size: number;
  file_extension: string;
  mime_type: string;
  category_id: number | null;
  source_type: 'upload' | 'drive';
  drive_url: string | null;
  downloads_count: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface TeacherFileListItem extends TeacherFileRow {
  category_name: string | null;
}

export interface ListFilesQuery {
  teacherId: number;
  page: number;
  limit: number;
  search?: string;
  categoryId?: number;
  fileType?: string;
  sortBy: 'created_at' | 'name' | 'file_size' | 'downloads_count';
  sortOrder: 'asc' | 'desc';
}

export interface FileStatistics {
  totalFiles: number;
  totalStorageUsed: string;
  totalStorageUsedBytes: number;
  totalDownloads: number;
  filesByType: Record<string, number>;
}

export interface StorageUploadResult {
  fileUrl: string;
  fileKey: string;
  deliveryType?: 'upload' | 'authenticated' | 'private';
  resourceType?: 'image' | 'raw';
}

export type StorageAccessMode = 'public' | 'authenticated';

export type StorageUploadOptions = {
  access?: StorageAccessMode;
  folder?: string;
  tenantId?: number;
};
