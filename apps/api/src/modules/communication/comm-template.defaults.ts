import { CommChannel, CommTemplateCategory } from '@prisma/client';

export interface DefaultTemplate {
  key: string;
  name: string;
  channel: CommChannel;
  category: CommTemplateCategory;
  language: string;
  subject?: string;
  bodyHtml?: string;
  bodyText: string;
}

/**
 * Starter wording. Everything here is generic on purpose: no prices, dates, availability, visa outcomes or booking
 * facts are written into a template. They are filled in from values the sender supplies, or from the person's own
 * record for service messages.
 *
 * The Hausa and Arabic opt-in confirmations are short and conventional; have a native speaker review them before
 * they are submitted to Meta.
 */
export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  // ----------------------------------------------------------------------------------------------- email, promotional
  {
    key: 'flight_offer',
    name: 'Flight offer',
    channel: 'EMAIL',
    category: 'MARKETING',
    language: 'en',
    subject: 'Flight offer: {{destination}}',
    bodyHtml:
      '<h2>Hello {{first_name}},</h2><p>{{offer}}</p><p>Destination: <strong>{{destination}}</strong>. Offer valid until {{valid_until}}.</p><p><a href="{{link}}">See the details</a></p>',
    bodyText:
      'Hello {{first_name}},\n\n{{offer}}\nDestination: {{destination}}. Offer valid until {{valid_until}}.\n{{link}}',
  },
  {
    key: 'umrah_announcement',
    name: 'Umrah announcement',
    channel: 'EMAIL',
    category: 'MARKETING',
    language: 'en',
    subject: 'Umrah update from {{company_name}}',
    bodyHtml:
      '<h2>Assalamu alaikum {{first_name}},</h2><p>{{offer}}</p><p>Package: <strong>{{package_name}}</strong>. Departure: {{departure_date}}.</p><p><a href="{{link}}">Read more and register your interest</a></p>',
    bodyText:
      'Assalamu alaikum {{first_name}},\n\n{{offer}}\nPackage: {{package_name}}. Departure: {{departure_date}}.\n{{link}}',
  },
  {
    key: 'hajj_update',
    name: 'Hajj update',
    channel: 'EMAIL',
    category: 'MARKETING',
    language: 'en',
    subject: 'Hajj update from {{company_name}}',
    bodyHtml:
      '<h2>Assalamu alaikum {{first_name}},</h2><p>{{message}}</p><p><a href="{{link}}">More information</a></p>',
    bodyText: 'Assalamu alaikum {{first_name}},\n\n{{message}}\n{{link}}',
  },
  {
    key: 'visa_update',
    name: 'Visa news',
    channel: 'EMAIL',
    category: 'MARKETING',
    language: 'en',
    subject: 'Visa news from {{company_name}}',
    bodyHtml:
      '<h2>Hello {{first_name}},</h2><p>{{message}}</p><p><a href="{{link}}">Read more</a></p>',
    bodyText: 'Hello {{first_name}},\n\n{{message}}\n{{link}}',
  },
  {
    key: 'travel_tips',
    name: 'Travel tips',
    channel: 'EMAIL',
    category: 'MARKETING',
    language: 'en',
    subject: 'Travel tips from {{company_name}}',
    bodyHtml: '<h2>Hello {{first_name}},</h2><p>{{message}}</p>',
    bodyText: 'Hello {{first_name}},\n\n{{message}}',
  },
  {
    key: 'newsletter',
    name: 'Newsletter',
    channel: 'EMAIL',
    category: 'MARKETING',
    language: 'en',
    subject: '{{company_name}} newsletter',
    bodyHtml:
      '<h2>Hello {{first_name}},</h2><p>{{message}}</p><p><a href="{{link}}">Read the full newsletter</a></p>',
    bodyText: 'Hello {{first_name}},\n\n{{message}}\n{{link}}',
  },
  {
    key: 'announcement',
    name: 'Announcement',
    channel: 'EMAIL',
    category: 'MARKETING',
    language: 'en',
    subject: 'An announcement from {{company_name}}',
    bodyHtml: '<h2>Hello {{first_name}},</h2><p>{{message}}</p>',
    bodyText: 'Hello {{first_name}},\n\n{{message}}',
  },
  // ----------------------------------------------------------------------------------------------- email, service
  {
    key: 'booking_update',
    name: 'Booking update',
    channel: 'EMAIL',
    category: 'UTILITY',
    language: 'en',
    subject: 'Update on your booking {{booking_ref}}',
    bodyHtml:
      '<p>Hello {{first_name}},</p><p>Your booking <strong>{{booking_ref}}</strong> is now: <strong>{{status}}</strong>.</p><p>Questions? Call {{contact_phone}}.</p>',
    bodyText:
      'Hello {{first_name}},\n\nYour booking {{booking_ref}} is now: {{status}}.\nQuestions? Call {{contact_phone}}.',
  },
  {
    key: 'payment_reminder',
    name: 'Payment reminder',
    channel: 'EMAIL',
    category: 'UTILITY',
    language: 'en',
    subject: 'Payment reminder for booking {{booking_ref}}',
    bodyHtml:
      '<p>Hello {{first_name}},</p><p>A reminder that {{amount}} is due on {{due_date}} for booking <strong>{{booking_ref}}</strong>.</p><p><a href="{{link}}">Pay securely online</a></p>',
    bodyText:
      'Hello {{first_name}},\n\nA reminder that {{amount}} is due on {{due_date}} for booking {{booking_ref}}.\nPay securely: {{link}}',
  },
  {
    key: 'visa_document_reminder',
    name: 'Visa document reminder',
    channel: 'EMAIL',
    category: 'UTILITY',
    language: 'en',
    subject: 'Document needed for your visa application {{booking_ref}}',
    bodyHtml:
      '<p>Hello {{first_name}},</p><p>We still need <strong>{{document_name}}</strong> for your visa application {{booking_ref}}. Please send it by {{due_date}}.</p>',
    bodyText:
      'Hello {{first_name}},\n\nWe still need {{document_name}} for your visa application {{booking_ref}}. Please send it by {{due_date}}.',
  },
  {
    key: 'travel_reminder',
    name: 'Travel reminder',
    channel: 'EMAIL',
    category: 'UTILITY',
    language: 'en',
    subject: 'Your trip to {{destination}} departs on {{departure_date}}',
    bodyHtml:
      '<p>Hello {{first_name}},</p><p>Your trip to <strong>{{destination}}</strong> departs on <strong>{{departure_date}}</strong> (booking {{booking_ref}}). Please check your documents and arrive early.</p>',
    bodyText:
      'Hello {{first_name}},\n\nYour trip to {{destination}} departs on {{departure_date}} (booking {{booking_ref}}). Please check your documents and arrive early.',
  },
  // ----------------------------------------------------------------------------------------------- WhatsApp
  {
    key: 'optin_confirm',
    name: 'Confirm your subscription',
    channel: 'WHATSAPP',
    category: 'UTILITY',
    language: 'en',
    bodyText:
      'Hello {{first_name}}, you asked to receive travel offers from {{company_name}} on WhatsApp. Reply CONFIRM to subscribe, or ignore this message and nothing will be sent. Reply STOP at any time to unsubscribe.',
  },
  {
    key: 'optin_confirm',
    name: 'Confirm your subscription (Hausa)',
    channel: 'WHATSAPP',
    category: 'UTILITY',
    language: 'ha',
    bodyText:
      'Sannu {{first_name}}, ka nemi karɓar tallace-tallacen tafiye-tafiye daga {{company_name}} ta WhatsApp. Ka amsa CONFIRM don amincewa, ko ka share wannan saƙo kuma ba za a aiko maka komai ba. Ka amsa STOP a kowane lokaci don ficewa.',
  },
  {
    key: 'optin_confirm',
    name: 'Confirm your subscription (Arabic)',
    channel: 'WHATSAPP',
    category: 'UTILITY',
    language: 'ar',
    bodyText:
      'مرحباً {{first_name}}، لقد طلبت تلقي عروض السفر من {{company_name}} عبر واتساب. أرسل CONFIRM للاشتراك، أو تجاهل هذه الرسالة ولن يُرسل إليك شيء. أرسل STOP في أي وقت لإلغاء الاشتراك.',
  },
  {
    key: 'umrah_announcement',
    name: 'Umrah announcement',
    channel: 'WHATSAPP',
    category: 'MARKETING',
    language: 'en',
    bodyText:
      'Assalamu alaikum {{first_name}}. {{offer}} Details: {{link}} Reply STOP to unsubscribe.',
  },
  {
    key: 'flight_offer',
    name: 'Flight offer',
    channel: 'WHATSAPP',
    category: 'MARKETING',
    language: 'en',
    bodyText:
      'Hello {{first_name}}, {{offer}} Travel to {{destination}} before {{valid_until}}. See: {{link}} Reply STOP to opt out.',
  },
  {
    key: 'booking_update',
    name: 'Booking update',
    channel: 'WHATSAPP',
    category: 'UTILITY',
    language: 'en',
    bodyText:
      'Hello {{first_name}}, an update on your booking {{booking_ref}}: {{status}}. Questions? Call {{contact_phone}}.',
  },
  {
    key: 'payment_reminder',
    name: 'Payment reminder',
    channel: 'WHATSAPP',
    category: 'UTILITY',
    language: 'en',
    bodyText:
      'Hello {{first_name}}, a reminder that {{amount}} is due on {{due_date}} for booking {{booking_ref}}. Pay securely: {{link}}',
  },
  {
    key: 'visa_document_reminder',
    name: 'Visa document reminder',
    channel: 'WHATSAPP',
    category: 'UTILITY',
    language: 'en',
    bodyText:
      'Hello {{first_name}}, we still need {{document_name}} for your visa application {{booking_ref}}. Please send it by {{due_date}}.',
  },
  {
    key: 'travel_reminder',
    name: 'Travel reminder',
    channel: 'WHATSAPP',
    category: 'UTILITY',
    language: 'en',
    bodyText:
      'Hello {{first_name}}, your trip to {{destination}} departs on {{departure_date}} (booking {{booking_ref}}). Please check your documents and arrive early.',
  },
];
