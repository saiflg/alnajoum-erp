'use client';

import { CommPage } from '@/components/comm/CommPage';
import { ContactsList } from '@/components/comm/ContactsList';

export default function SubscribersPage() {
  return (
    <CommPage title="Subscribers">
      <ContactsList initial={{ subscribedTo: 'EMAIL', subscription: 'SUBSCRIBED' }} />
    </CommPage>
  );
}
