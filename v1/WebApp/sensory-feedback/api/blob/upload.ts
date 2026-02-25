import { put } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { filename, data } = req.body as { filename: string; data: string };

    if (!filename || !data) {
      return res.status(400).json({ error: 'Missing filename or data' });
    }

    const blob = await put(filename, data, {
      access: 'public',
      contentType: 'text/csv',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return res.status(200).json(blob);
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: 'Failed to upload' });
  }
}
