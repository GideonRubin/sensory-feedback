import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = req.query;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing blob URL' });
    }

    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch blob' });
    }

    const data = await response.text();
    return res.status(200).json({ data });
  } catch (error) {
    console.error('Download error:', error);
    return res.status(500).json({ error: 'Failed to download blob' });
  }
}
