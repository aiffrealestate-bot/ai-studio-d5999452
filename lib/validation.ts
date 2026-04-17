import { z } from 'zod';

// -------------------------------------------------------
// Reusable field primitives
// -------------------------------------------------------

const hebrewOrLatinName = z
  .string()
  .min(2, 'השם חייב להכיל לפחות 2 תווים')
  .max(120, 'השם ארוך מדי')
  .regex(
    /^[\u0590-\u05FFa-zA-Z\s'"\-\.]+$/,
    'השם יכול להכיל אותיות בעברית או באנגלית בלבד'
  );

const israeliPhone = z
  .string()
  .min(9, 'מספר טלפון לא תקין')
  .max(15, 'מספר טלפון לא תקין')
  .regex(
    /^(\+972|0)([-\s]?)([23489]|5[02348]|77)([-\s]?)\d{3}([-\s]?)\d{4}$/,
    'יש להזין מספר טלפון ישראלי תקין'
  );

const emailField = z
  .string()
  .email('כתובת דוא"ל לא תקינה')
  .max(254, 'כתובת דוא"ל ארוכה מדי');

const messageField = z
  .string()
  .min(10, 'ההודעה חייבת להכיל לפחות 10 תווים')
  .max(2000, 'ההודעה ארוכה מדי (מקסימום 2000 תווים)');

// -------------------------------------------------------
// Practice area enum — matches DB constraint
// -------------------------------------------------------
export const practiceAreaEnum = z.enum([
  'corporate',
  'real_estate',
  'litigation',
  'family',
  'criminal',
  'employment',
  'intellectual_property',
  'tax',
  'banking_finance',
  'mergers_acquisitions',
  'administrative',
  'other',
]);

export type PracticeArea = z.infer<typeof practiceAreaEnum>;

// -------------------------------------------------------
// Lead / Contact Form Schema
// -------------------------------------------------------
export const leadSchema = z.object({
  full_name: hebrewOrLatinName,
  email: emailField,
  phone: israeliPhone,
  practice_area: practiceAreaEnum.optional().default('other'),
  message: messageField,
  // Honeypot anti-spam field — must be empty
  website: z
    .string()
    .max(0, 'שדה זה חייב להיות ריק')
    .optional()
    .default(''),
  // GDPR / consent
  consent_given: z
    .boolean()
    .refine((v) => v === true, {
      message: 'יש לאשר את תנאי השימוש ומדיניות הפרטיות',
    }),
});

export type LeadInput = z.infer<typeof leadSchema>;

// -------------------------------------------------------
// Newsletter / Quick-capture schema (email only)
// -------------------------------------------------------
export const newsletterSchema = z.object({
  email: emailField,
  consent_given: z
    .boolean()
    .refine((v) => v === true, {
      message: 'יש לאשר קבלת עדכונים',
    }),
});

export type NewsletterInput = z.infer<typeof newsletterSchema>;

// -------------------------------------------------------
// Consultation Booking Schema
// -------------------------------------------------------
export const consultationSchema = z.object({
  full_name: hebrewOrLatinName,
  email: emailField,
  phone: israeliPhone,
  practice_area: practiceAreaEnum,
  preferred_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'יש להזין תאריך בפורמט YYYY-MM-DD')
    .refine((d) => {
      const date = new Date(d);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return date >= today;
    }, 'לא ניתן לבחור תאריך שעבר'),
  preferred_time: z
    .string()
    .regex(/^([0-1]\d|2[0-3]):[0-5]\d$/, 'יש להזין שעה בפורמט HH:MM'),
  notes: z.string().max(500, 'הערות ארוכות מדי').optional().default(''),
  consent_given: z
    .boolean()
    .refine((v) => v === true, {
      message: 'יש לאשר את תנאי השימוש',
    }),
});

export type ConsultationInput = z.infer<typeof consultationSchema>;
