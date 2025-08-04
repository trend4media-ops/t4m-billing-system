import { Router } from "express";
import { login } from "../auth/login";
import { registerManager } from "../auth/register";

const authRouter = Router();

authRouter.post("/login", login);
authRouter.post("/register", registerManager);

export { authRouter }; 