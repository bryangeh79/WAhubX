import { AccountSlotStatus } from '../account-slot.entity';

export class SlotResponseDto {
  id!: number;
  tenantId!: number;
  slotIndex!: number;
  status!: AccountSlotStatus;
  accountId!: number | null;
  phoneNumber!: string | null;
  waNickname!: string | null;
  warmupStage!: number | null;
  proxyId!: number | null;
  profilePath!: string | null;
  createdAt!: Date;
}
