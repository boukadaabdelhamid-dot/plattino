import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import authRouter from "./auth";
import productsRouter from "./products";
import cartRouter from "./cart";
import ordersRouter from "./orders";
import erpRouter from "./erp";
import erpSettingsRouter from "./erp-settings";
import storesRouter from "./stores";
import transfersRouter from "./transfers";
import caissesRouter from "./caisses";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(authRouter);
router.use(productsRouter);
router.use(cartRouter);
router.use(ordersRouter);
router.use(storesRouter);
router.use(transfersRouter);
router.use(caissesRouter);
router.use(erpRouter);
router.use(erpSettingsRouter);

export default router;
