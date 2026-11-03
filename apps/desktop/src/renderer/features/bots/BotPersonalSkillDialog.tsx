import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { getDataOwnerGeneration, isDataOwnerGenerationCurrent } from '@/contexts/dataOwnerGeneration';

import type { BotSkillDetail } from '../../../shared/botSkill';
import { useBotTranslation } from './botPronounContext';
import type { BotCapabilityEntry, BotSettingsTarget } from './botSettingsTarget';

type PersonalSkillApi = NonNullable<BotSettingsTarget['capabilities']['personal']>;

export function BotPersonalSkillDialog({
  botId,
  item,
  api,
  onOpenChange,
  onSaved,
}: {
  botId: string;
  item: BotCapabilityEntry;
  api: PersonalSkillApi;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useBotTranslation();
  const [detail, setDetail] = useState<BotSkillDetail | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const owner = getDataOwnerGeneration();
    let current = true;
    setLoading(true);
    setFailed(false);
    void api.read(botId, item.personalSlug!)
      .then((next) => {
        if (!current || !isDataOwnerGenerationCurrent(owner)) return;
        if (!next) throw new Error('Skill unavailable');
        setDetail(next);
        setName(next.name);
        setDescription(next.description);
        setBody(next.body);
      })
      .catch(() => {
        if (current && isDataOwnerGenerationCurrent(owner)) setFailed(true);
      })
      .finally(() => {
        if (current && isDataOwnerGenerationCurrent(owner)) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [api, botId, item.personalSlug]);

  const invalid = !name.trim() || !description.trim() || !body.trim();
  const save = async () => {
    if (!detail || invalid || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await api.update(botId, {
        slug: detail.slug,
        name,
        description,
        body,
        expectedUpdatedAt: detail.updatedAt,
      });
      onSaved();
      onOpenChange(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(next) => !saving && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-scrim fixed inset-0 z-[70]" />
        <Dialog.Content
          aria-describedby="bot-personal-skill-description"
          onPointerDownOutside={(event) => event.preventDefault()}
          className="modal-panel fixed inset-0 z-[71] m-auto flex h-fit max-h-[85vh] w-[min(640px,calc(100vw-32px))] flex-col p-4 outline-none"
        >
          <div className="min-w-0">
            <Dialog.Title className="truncate text-18 font-medium text-[var(--text-primary)]">
              {detail?.name ?? item.name}
            </Dialog.Title>
            <Dialog.Description id="bot-personal-skill-description" className="mt-1 text-13 leading-5 text-[var(--text-secondary)]">
              {t('bots.capabilities.personalSkill.editHint')}
            </Dialog.Description>
          </div>

          <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {loading ? (
              <p className="text-12 text-[var(--text-secondary)]" role="status">
                {t('bots.capabilities.personalSkill.loading')}
              </p>
            ) : detail ? (
              <>
                <label className="block">
                  <span className="mb-1.5 ml-1 block text-12 text-[var(--text-secondary)]">
                    {t('bots.capabilities.personalSkill.name')}
                  </span>
                  <Input size="md" value={name} maxLength={64} onChange={setName} />
                </label>
                <label className="block">
                  <span className="mb-1.5 ml-1 block text-12 text-[var(--text-secondary)]">
                    {t('bots.capabilities.personalSkill.description')}
                  </span>
                  <Input size="md" value={description} maxLength={280} onChange={setDescription} />
                </label>
                <label className="block">
                  <span className="mb-1.5 ml-1 block text-12 text-[var(--text-secondary)]">
                    {t('bots.capabilities.personalSkill.body')}
                  </span>
                  <Textarea
                    rows={14}
                    value={body}
                    maxLength={55_000}
                    onChange={setBody}
                    className="min-h-[260px] resize-y text-13 leading-[1.7]"
                  />
                </label>
              </>
            ) : null}
            {failed ? (
              <p className="text-12 text-[var(--text-danger)]" role="alert">
                {t(detail ? 'bots.capabilities.personalSkill.saveFailed' : 'bots.capabilities.personalSkill.loadFailed')}
              </p>
            ) : null}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary" size="md" disabled={saving}>
                {t('bots.cancel')}
              </Button>
            </Dialog.Close>
            <Button
              variant="cta"
              size="md"
              loading={saving}
              disabled={!detail || invalid || saving}
              onClick={() => void save()}
            >
              {t('bots.save')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
