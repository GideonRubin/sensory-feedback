import { del } from '@vercel/blob';

type VercelRequest = {
  method?: string;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => {
    json: (body: unknown) => unknown;
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = req.body as { url: string };

    if (!url) {
      return res.status(400).json({ error: 'Missing blob URL' });
    }

    await del(url);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    return res.status(500).json({ error: 'Failed to delete blob' });
  }
}
