import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { ok, created } from '../../utils/apiResponse';
import { query } from '../../db/pool';
import { recordAudit } from '../../utils/audit';
import { ApiError } from '../../types';

const router = Router();

// MSG-1: blocks phone numbers, emails, and common external-handle patterns pre-consent.
const CONTACT_DETAIL_PATTERN =
  /(\+?\d[\d\s().-]{7,}\d)|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|(\b(instagram|whatsapp|telegram|snapchat|@)\b\s*[:@]?\s*\w+)/gi;

function redact(body: string): { redacted: string; wasRedacted: boolean } {
  const wasRedacted = CONTACT_DETAIL_PATTERN.test(body);
  CONTACT_DETAIL_PATTERN.lastIndex = 0;
  const redacted = wasRedacted ? body.replace(CONTACT_DETAIL_PATTERN, '[redacted — contact details are shared only after mutual consent]') : body;
  return { redacted, wasRedacted };
}

router.get(
  '/conversations',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await query(
      `SELECT c.*, (
         SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1
       ) AS last_message
       FROM conversations c
       WHERE c.donor_user_id = $1 OR c.recipient_user_id = $1
       ORDER BY c.created_at DESC`,
      [req.user!.id]
    );
    return ok(res, { conversations: result.rows });
  })
);

const startSchema = z.object({ donorUserId: z.string().uuid(), recipientUserId: z.string().uuid() });

router.post(
  '/conversations',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { donorUserId, recipientUserId } = startSchema.parse(req.body);
    const result = await query(
      `INSERT INTO conversations (donor_user_id, recipient_user_id) VALUES ($1, $2)
       ON CONFLICT (donor_user_id, recipient_user_id) DO UPDATE SET donor_user_id = EXCLUDED.donor_user_id
       RETURNING *`,
      [donorUserId, recipientUserId]
    );
    return created(res, { conversation: result.rows[0] });
  })
);

router.get(
  '/conversations/:id/messages',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await query(
      'SELECT id, sender_id, body, was_redacted, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    return ok(res, { messages: result.rows });
  })
);

const sendSchema = z.object({ body: z.string().min(1).max(4000) });

router.post(
  '/conversations/:id/messages',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { body } = sendSchema.parse(req.body);
    const { redacted, wasRedacted } = redact(body);

    const result = await query(
      `INSERT INTO messages (conversation_id, sender_id, body, original_body, was_redacted)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, sender_id, body, was_redacted, created_at`,
      [req.params.id, req.user!.id, redacted, body, wasRedacted]
    );

    if (wasRedacted) {
      await query(
        `INSERT INTO trust_safety_flags (subject_type, subject_id, flagged_by, reason, confidence)
         VALUES ('message', $1, NULL, 'Automated: possible contact-detail sharing pre-consent', 'medium')`,
        [result.rows[0].id]
      );
    }

    return created(res, { message: result.rows[0] });
  })
);

// MSG-2: contact details unlock only once both parties independently confirm.
router.post(
  '/conversations/:id/request-contact-share',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    await query(
      `INSERT INTO consent_confirmations (conversation_id, user_id) VALUES ($1, $2)
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      [req.params.id, req.user!.id]
    );

    const confirmations = await query<{ user_id: string }>(
      'SELECT user_id FROM consent_confirmations WHERE conversation_id = $1',
      [req.params.id]
    );
    const conversation = await query<{ donor_user_id: string; recipient_user_id: string }>(
      'SELECT donor_user_id, recipient_user_id FROM conversations WHERE id = $1',
      [req.params.id]
    );
    if (!conversation.rowCount) throw new ApiError(404, 'Conversation not found');
    const { donor_user_id, recipient_user_id } = conversation.rows[0];
    const confirmedIds = new Set(confirmations.rows.map((r) => r.user_id));
    const bothConfirmed = confirmedIds.has(donor_user_id) && confirmedIds.has(recipient_user_id);

    if (bothConfirmed) {
      await query('UPDATE conversations SET contact_details_unlocked = true WHERE id = $1', [req.params.id]);
      await recordAudit({ actorId: req.user!.id, action: 'messaging.mutual_consent_confirmed', resourceType: 'conversation', resourceId: req.params.id });
    }

    return ok(res, { bothConfirmed, waitingOn: bothConfirmed ? null : 'the other party' });
  })
);

const reportSchema = z.object({
  reason: z.string().min(1).max(500),
  messageId: z.string().uuid().optional(),
});

// MSG-4: report a message/conversation for Trust & Safety review.
router.post(
  '/conversations/:id/report',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { reason, messageId } = reportSchema.parse(req.body);
    const result = await query(
      `INSERT INTO trust_safety_flags (subject_type, subject_id, flagged_by, reason, confidence)
       VALUES ($1, $2, $3, $4, 'high') RETURNING *`,
      [messageId ? 'message' : 'conversation', messageId ?? req.params.id, req.user!.id, reason]
    );
    return created(res, { case: result.rows[0] });
  })
);

export default router;
