import QRCode from 'qrcode';

export interface QRCodeData {
  activation_code: string;
  course_id?: number;
  package_id?: number;
  student_id?: number;
  expires_at?: string;
  created_at: string;
}

export class QRCodeService {
  // Generate QR code for activation code
  static async generateQRCode(data: QRCodeData): Promise<string> {
    try {
      // Create QR code data with activation info
      const qrData: any = {
        type: data.package_id ? 'package_activation_code' : 'activation_code',
        code: data.activation_code,
        expires_at: data.expires_at,
        created_at: data.created_at,
      };

      if (data.course_id) {
        qrData.course_id = data.course_id;
      }
      if (data.package_id) {
        qrData.package_id = data.package_id;
      }

      // Generate QR code as base64 string
      const qrCodeString = await QRCode.toDataURL(JSON.stringify(qrData), {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });

      return qrCodeString;
    } catch (error) {
      console.error('Error generating QR code:', error);
      throw new Error('فشل في إنشاء QR code');
    }
  }

  // Generate QR code with custom options
  static async generateQRCodeWithOptions(
    data: QRCodeData,
    options: {
      width?: number;
      margin?: number;
      color?: {
        dark: string;
        light: string;
      };
    } = {},
  ): Promise<string> {
    try {
      const qrData = {
        type: 'activation_code',
        code: data.activation_code,
        course_id: data.course_id,
        expires_at: data.expires_at,
        created_at: data.created_at,
      };

      const defaultOptions = {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      };

      const finalOptions = { ...defaultOptions, ...options };

      const qrCodeString = await QRCode.toDataURL(JSON.stringify(qrData), finalOptions);

      return qrCodeString;
    } catch (error) {
      console.error('Error generating QR code with options:', error);
      throw new Error('فشل في إنشاء QR code');
    }
  }

  // Parse QR code data
  static parseQRCodeData(qrDataString: string): QRCodeData | null {
    try {
      const data = JSON.parse(qrDataString);

      if (data.type !== 'activation_code' && data.type !== 'package_activation_code') {
        return null;
      }

      const result: QRCodeData = {
        activation_code: data.code,
        expires_at: data.expires_at,
        created_at: data.created_at,
      };

      if (data.course_id) {
        result.course_id = data.course_id;
      }
      if (data.package_id) {
        result.package_id = data.package_id;
      }

      return result;
    } catch (error) {
      console.error('Error parsing QR code data:', error);
      return null;
    }
  }

  // Validate QR code data
  static validateQRCodeData(data: QRCodeData): boolean {
    try {
      // Check required fields
      if (!data.activation_code || !data.created_at) {
        return false;
      }

      // Must have either course_id or package_id
      if (!data.course_id && !data.package_id) {
        return false;
      }

      // Check if code is expired
      if (data.expires_at) {
        const now = new Date();
        const expiresAt = new Date(data.expires_at);

        if (now > expiresAt) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Error validating QR code data:', error);
      return false;
    }
  }

  // Generate QR code for multiple activation codes
  static async generateMultipleQRCodes(codes: QRCodeData[]): Promise<
    Array<{
      activation_code: string;
      qr_code: string;
      course_id: number;
      expires_at?: string;
      created_at: string;
    }>
  > {
    try {
      const results = await Promise.all(
        codes.map(async (code) => {
          const qrCode = await this.generateQRCode(code);
          if (code.course_id === undefined) {
            throw new Error('course_id is required for generating QR codes');
          }
          return {
            activation_code: code.activation_code,
            qr_code: qrCode,
            course_id: code.course_id,
            expires_at: code.expires_at,
            created_at: code.created_at,
          };
        }),
      );

      return results;
    } catch (error) {
      console.error('Error generating multiple QR codes:', error);
      throw new Error('فشل في إنشاء QR codes متعددة');
    }
  }

  // Generate QR code with course and student info
  static async generateActivationQRCode(
    activationCode: string,
    courseId: number,
    studentId?: number,
    expiresAt?: string,
  ): Promise<string> {
    try {
      const qrData: QRCodeData = {
        activation_code: activationCode,
        course_id: courseId,
        student_id: studentId,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
      };

      return await this.generateQRCode(qrData);
    } catch (error) {
      console.error('Error generating activation QR code:', error);
      throw new Error('فشل في إنشاء QR code للتفعيل');
    }
  }
}
