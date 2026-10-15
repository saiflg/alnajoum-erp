'use client';

import { CampaignsList } from '@/components/comm/CampaignsList';
import { CommPage } from '@/components/comm/CommPage';

export default function EmailCampaignsPage() {
  return (
    <CommPage title="Email campaigns">
      <CampaignsList channel="EMAIL" />
    </CommPage>
  );
}
