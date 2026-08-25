/**
 * Soft-close body — intentionally empty.
 * [feature-spec.md decisions #10/#11] closed_by comes from @CurrentUser() only;
 * a client-supplied closed_by is rejected by global ValidationPipe
 * (forbidNonWhitelisted: true).
 */
export class SoftCloseAccountingPeriodDto {}
