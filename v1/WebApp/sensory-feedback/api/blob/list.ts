import { list } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { cursor } = req.query;
    const result = await list({
      cursor: cursor as string | undefined,
      limit: 100,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('List error:', error);
    return res.status(500).json({ error: 'Failed to list blobs' });
  }
}
