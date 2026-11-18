import { NextResponse } from 'next/server';

// Seeding complete — endpoint disabled for security
export async function POST() {
  return NextResponse.json({ error: 'Gone' }, { status: 410 });
}
