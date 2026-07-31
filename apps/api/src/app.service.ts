import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return { status: 'ok', service: 'alnajoum-erp-api', timestamp: new Date().toISOString() };
  }
}
