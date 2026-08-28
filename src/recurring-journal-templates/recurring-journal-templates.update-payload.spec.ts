import { RecurrenceFrequency } from '../common/enums/recurrence-frequency.enum';
import { UpdateRecurringJournalTemplateDto } from './dto/update-recurring-journal-template.dto';
import { SupabaseRecurringJournalTemplatesRepository } from './recurring-journal-templates.repository.supabase';

/**
 * [feature-spec.md §7.16 finding #3 / decision #43] Update payload never
 * includes company_id even if a stale typed object somehow carried it.
 */
describe('Recurring template update payload (decision #43)', () => {
  it('does not write company_id or created_by on update', async () => {
    const updatePayloads: Record<string, unknown>[] = [];
    const supabase = {
      client: {
        from: () => ({
          update: (row: Record<string, unknown>) => {
            updatePayloads.push(row);
            return {
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', ...row },
                    error: null,
                  }),
                }),
              }),
            };
          },
        }),
      },
    };

    const repo = new SupabaseRecurringJournalTemplatesRepository(supabase as never);
    const dto: UpdateRecurringJournalTemplateDto = {
      template_name: 'Updated',
      frequency: RecurrenceFrequency.Monthly,
    };

    await repo.update('dddddddd-dddd-dddd-dddd-dddddddddddd', dto);

    expect(updatePayloads).toHaveLength(1);
    expect(updatePayloads[0]).toEqual({
      template_name: 'Updated',
      frequency: RecurrenceFrequency.Monthly,
    });
    expect(updatePayloads[0]).not.toHaveProperty('company_id');
    expect(updatePayloads[0]).not.toHaveProperty('created_by');
  });
});
