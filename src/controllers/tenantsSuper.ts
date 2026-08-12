import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { requireDefaultTenantMiddleware } from '../middleware/tenantContext';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, HttpError } from '../utils';
import { TenantService, type CreateTenantInput } from '../services/tenants';
import {
  CreateTenantBodySchema,
  PatchTenantBodySchema,
  buildCreateTenantFromMultipart,
  buildPatchTenantFromMultipart,
  isMultipartRequest,
  uploadTenantFilesSafe,
} from '../utils/tenantFormPayload';

export const router = Router();

router.use(requireDefaultTenantMiddleware());
router.use(authMiddleware(['admin']));

router.get(
  '/',
  asyncWrapper(async (req, res) => {
    const limit = Number(req.query.limit ?? 200);
    const offset = Number(req.query.offset ?? 0);
    const detailed = req.query.detailed === 'true' || req.query.detailed === '1';

    if (detailed) {
      const { tenants, total } = await TenantService.listTeacherTenantsForAdmin({
        limit: Number.isFinite(limit) ? limit : 200,
        offset: Number.isFinite(offset) ? offset : 0,
      });
      return res.json({ success: true, tenants, total });
    }

    const rows = await TenantService.listAll(
      Number.isFinite(limit) ? limit : 200,
      Number.isFinite(offset) ? offset : 0,
    );
    res.json({ success: true, tenants: rows });
  }),
);

router.post(
  '/',
  (req, res, next) => {
    if (isMultipartRequest(req)) {
      return uploadTenantFilesSafe(req, res, next);
    }
    next();
  },
  (req, res, next) => {
    if (!isMultipartRequest(req)) {
      return validate(CreateTenantBodySchema)(req, res, next);
    }
    next();
  },
  asyncWrapper(async (req, res) => {
    try {
      let payload: CreateTenantInput;
      if (isMultipartRequest(req)) {
        const built = await buildCreateTenantFromMultipart(req);
        if ('error' in built) {
          return res.status(400).json({ success: false, message: built.error });
        }
        payload = built.data;
      } else {
        payload = req.body as CreateTenantInput;
      }
      const row = await TenantService.createTenantTransaction(payload);
      res.status(201).json({ success: true, tenant: row });
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === '23505') {
        return res.status(409).json({ success: false, message: 'Subdomain already taken' });
      }
      throw e;
    }
  }),
);

router.patch(
  '/:id',
  (req, res, next) => {
    if (isMultipartRequest(req)) {
      return uploadTenantFilesSafe(req, res, next);
    }
    next();
  },
  (req, res, next) => {
    if (!isMultipartRequest(req)) {
      return validate(PatchTenantBodySchema)(req, res, next);
    }
    next();
  },
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) return res.status(400).json({ message: 'Invalid id' });

    let payload;
    if (isMultipartRequest(req)) {
      const built = await buildPatchTenantFromMultipart(req);
      if ('error' in built) {
        return res.status(400).json({ success: false, message: built.error });
      }
      payload = built.data;
    } else {
      payload = req.body;
    }

    try {
      const tenant = await TenantService.patchTenant(id, payload);
      res.json({ success: true, tenant });
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === '23505') {
        return res.status(409).json({ success: false, message: 'Subdomain already taken' });
      }
      if (err.message === 'Tenant not found') {
        throw new HttpError(404, 'Tenant not found');
      }
      throw e;
    }
  }),
);

router.delete(
  '/:id',
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) return res.status(400).json({ message: 'Invalid id' });

    const confirmSubdomain =
      typeof req.body?.confirm_subdomain === 'string'
        ? req.body.confirm_subdomain
        : typeof req.query.confirm_subdomain === 'string'
          ? req.query.confirm_subdomain
          : undefined;

    const result = await TenantService.deleteTenantForAdmin(id, { confirmSubdomain });
    res.json({ success: true, message: 'Tenant deleted', data: result });
  }),
);
