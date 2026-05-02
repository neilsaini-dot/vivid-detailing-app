import { Router, type IRouter } from "express";
import healthRouter from "./health";
import servicesRouter from "./services";
import addOnsRouter from "./addons";
import pricingRouter from "./pricing";
import bookingsRouter from "./bookings";
import customersRouter from "./customers";
import vehiclesRouter from "./vehicles";
import quotesRouter from "./quotes";
import adminRouter from "./admin";
import calendarRouter from "./calendar";

const router: IRouter = Router();

router.use(healthRouter);
router.use(servicesRouter);
router.use(addOnsRouter);
router.use(pricingRouter);
router.use(bookingsRouter);
router.use(customersRouter);
router.use(vehiclesRouter);
router.use(quotesRouter);
router.use(adminRouter);
router.use(calendarRouter);

export default router;
