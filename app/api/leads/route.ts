import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { leadSchema } from '@/lib/validation';
import { getPublicSupabaseClient } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// In-memory rate limiter (per-IP, resets every window)
// For production, replace with Redis / Upstash backed limiter.
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 5;

interface RateEntry {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateEntry>();

function getRateLimitHeaders(
  remaining: number,
  resetAt: number
): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(Math.floor(resetAt / 1000)),
    'X-RateLimit-Policy': `${RATE_LIMIT_MAX_REQUESTS};w=60`,
  };
}

function checkRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    };
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.windowStart + RATE_LIMIT_WINDOW_MS,
    };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - entry.count,
    resetAt: entry.windowStart + RATE_LIMIT_WINDOW_MS,
  };
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

// ---------------------------------------------------------------------------
// POST /api/leads
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { allowed, remaining, resetAt } = checkRateLimit(ip);
  const rateLimitHeaders = getRateLimitHeaders(remaining, resetAt);

  if (!allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'יותר מדי בקשות. אנא המתן דקה ונסה שנית.',
        code: 'RATE_LIMITED',
      },
      { status: 429, headers: { ...rateLimitHeaders, 'Retry-After': '60' } }
    );
  }

  // Parse request body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'גוף הבקשה אינו JSON תקין.',
        code: 'INVALID_JSON',
      },
      { status: 400, headers: rateLimitHeaders }
    );
  }

  // Validate with Zod
  let validatedData;
  try {
    validatedData = leadSchema.parse(rawBody);
  } catch (err) {
    if (err instanceof ZodError) {
      const fieldErrors = err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return NextResponse.json(
        {
          success: false,
          error: 'נתונים שגויים. אנא בדוק את הטופס ונסה שנית.',
          code: 'VALIDATION_ERROR',
          details: fieldErrors,
        },
        { status: 422, headers: rateLimitHeaders }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: 'שגיאה בעיבוד הנתונים.',
        code: 'PARSE_ERROR',
      },
      { status: 400, headers: rateLimitHeaders }
    );
  }

  // Honeypot check
  if (validatedData.website && validatedData.website.length > 0) {
    // Silently accept but do not persist — treat as bot submission
    return NextResponse.json(
      { success: true, message: 'פנייתך התקבלה. ניצור איתך קשר בקרוב.' },
      { status: 200, headers: rateLimitHeaders }
    );
  }

  // Persist to Supabase (RLS policy enforces insert-only for anon role)
  const supabase = getPublicSupabaseClient();

  const { error: dbError } = await supabase.from('leads').insert({
    full_name: validatedData.full_name,
    email: validatedData.email,
    phone: validatedData.phone,
    practice_area: validatedData.practice_area,
    message: validatedData.message,
    consent_given: validatedData.consent_given,
    source_url: req.headers.get('referer') ?? null,
    ip_address: ip,
    created_at: new Date().toISOString(),
  });

  if (dbError) {
    console.error('[POST /api/leads] Supabase insert error:', dbError);
    return NextResponse.json(
      {
        success: false,
        error: 'אירעה שגיאה בשמירת הפנייה. אנא נסה שנית מאוחר יותר.',
        code: 'DB_ERROR',
      },
      { status: 500, headers: rateLimitHeaders }
    );
  }

  return NextResponse.json(
    {
      success: true,
      message: 'פנייתך התקבלה בהצלחה. ניצור איתך קשר בהקדם האפשרי.',
    },
    { status: 201, headers: rateLimitHeaders }
  );
}

// ---------------------------------------------------------------------------
// OPTIONS — CORS preflight support
// ---------------------------------------------------------------------------
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'POST, OPTIONS',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
