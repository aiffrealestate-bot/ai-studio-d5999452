import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'law-firm-landing-api',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV ?? 'unknown',
    },
    {
      status: 200,
      headers: {
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '99',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
        'Cache-Control': 'no-store',
      },
    }
  );
}
