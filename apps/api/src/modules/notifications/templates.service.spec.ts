import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TemplatesService } from './templates.service';

describe('TemplatesService', () => {
  let service: TemplatesService;
  let prisma: {
    messageTemplate: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      messageTemplate: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplatesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(TemplatesService);
  });

  describe('render (spec #22)', () => {
    it('substitutes every known {{variable}}', () => {
      const rendered = service.render(
        'Hello {{customer_name}}, your {{service_type}} is ready.',
        {
          customer_name: 'Amina',
          service_type: 'visa',
        },
      );
      expect(rendered).toBe('Hello Amina, your visa is ready.');
    });

    it('leaves an unknown variable untouched rather than throwing', () => {
      const rendered = service.render(
        'Hello {{customer_name}}, ref {{unknown_var}}.',
        {
          customer_name: 'Amina',
        },
      );
      expect(rendered).toBe('Hello Amina, ref {{unknown_var}}.');
    });

    it('HTML-escapes a variable value instead of injecting it verbatim, so a value cannot smuggle in markup or another {{template}} tag', () => {
      const rendered = service.render('Hello {{customer_name}}!', {
        customer_name: '<script>alert(1)</script>{{malicious}}',
      });
      expect(rendered).not.toContain('<script>');
      expect(rendered).toContain('&lt;script&gt;');
      // The escaped payload's own "{{malicious}}" text is inert — the
      // template engine never re-scans its own substitution output for a
      // second pass of {{...}} replacement.
      expect(rendered).toContain('{{malicious}}');
    });

    it('never evaluates the template as code even if a variable looks like a function call', () => {
      const rendered = service.render('{{payload}}', {
        payload: '${process.exit(1)}',
      });
      expect(rendered).toBe('${process.exit(1)}');
    });
  });

  describe('renderByKey', () => {
    it('returns null for an inactive template rather than sending a disabled message', async () => {
      prisma.messageTemplate.findUnique.mockResolvedValue({
        key: 'WELCOME_EMAIL',
        body: 'Hi {{customer_name}}',
        subject: 'Welcome',
        channel: 'EMAIL',
        isActive: false,
      });

      const result = await service.renderByKey('WELCOME_EMAIL', {
        customer_name: 'Amina',
      });
      expect(result).toBeNull();
    });

    it('renders both subject and body for an active template', async () => {
      prisma.messageTemplate.findUnique.mockResolvedValue({
        key: 'WELCOME_EMAIL',
        body: 'Hi {{customer_name}}',
        subject: 'Welcome {{customer_name}}',
        channel: 'EMAIL',
        isActive: true,
      });

      const result = await service.renderByKey('WELCOME_EMAIL', {
        customer_name: 'Amina',
      });
      expect(result).toEqual({
        subject: 'Welcome Amina',
        body: 'Hi Amina',
        channel: 'EMAIL',
      });
    });
  });
});
