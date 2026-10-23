import sharp from 'sharp';

export type CropBBox = {
  top_left_x: number;
  top_left_y: number;
  bottom_right_x: number;
  bottom_right_y: number;
};

export type PageDimensions = {
  width?: number;
  height?: number;
  dpi?: number;
} | null;

/**
 * Crop a table/figure region from a page raster.
 * OCR bbox coords are relative to OCR page dimensions; scale when the
 * source buffer size differs (e.g. PDF rasterized at a different DPI).
 */
export async function cropPageRegionToJpegDataUri(
  pageBuffer: Buffer,
  bbox: CropBBox,
  pageDimensions?: PageDimensions,
  padding = 6,
): Promise<string | null> {
  const meta = await sharp(pageBuffer).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;
  if (imgW <= 0 || imgH <= 0) return null;

  const refW = pageDimensions?.width && pageDimensions.width > 0 ? pageDimensions.width : imgW;
  const refH = pageDimensions?.height && pageDimensions.height > 0 ? pageDimensions.height : imgH;
  const scaleX = imgW / refW;
  const scaleY = imgH / refH;

  let left = Math.floor(bbox.top_left_x * scaleX) - padding;
  let top = Math.floor(bbox.top_left_y * scaleY) - padding;
  let right = Math.ceil(bbox.bottom_right_x * scaleX) + padding;
  let bottom = Math.ceil(bbox.bottom_right_y * scaleY) + padding;

  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(imgW, right);
  bottom = Math.min(imgH, bottom);

  const width = right - left;
  const height = bottom - top;
  if (width < 8 || height < 8) return null;

  const cropped = await sharp(pageBuffer)
    .extract({ left, top, width, height })
    .jpeg({ quality: 90 })
    .toBuffer();

  return `data:image/jpeg;base64,${cropped.toString('base64')}`;
}
