'use client';

import { CampaignsList } from '@/components/comm/CampaignsList';
import { CommPage } from '@/components/comm/CommPage';

export default function WhatsAppCampaignsPage() {
  return (
    <CommPage title="WhatsApp campaigns">
      <CampaignsList channel="WHATSAPP" />
    </CommPage>
  );
}
