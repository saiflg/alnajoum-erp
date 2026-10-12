'use client';

import { CommPage } from '@/components/comm/CommPage';
import { ContactsList } from '@/components/comm/ContactsList';

export default function ContactsPage() {
  return (
    <CommPage title="Contacts">
      <ContactsList />
    </CommPage>
  );
}
