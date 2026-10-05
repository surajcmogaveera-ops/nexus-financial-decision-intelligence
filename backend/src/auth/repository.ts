import { getPrismaClient } from "../db/prisma.js";
import type { PrismaClient } from "../generated/prisma/client.js";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string | null;
}

export interface NewAuthUser {
  email: string;
  displayName: string | null;
  passwordHash: string;
}

export interface AuthUserRepository {
  findByEmail(email: string): Promise<AuthUser | null>;
  findById(id: string): Promise<AuthUser | null>;
  create(data: NewAuthUser): Promise<AuthUser>;
}

export class PrismaAuthUserRepository implements AuthUserRepository {
  constructor(private readonly clientProvider: () => PrismaClient = getPrismaClient) {}

  async findByEmail(email: string): Promise<AuthUser | null> {
    const user = await this.clientProvider().user.findUnique({ where: { email } });
    return user as AuthUser | null;
  }

  async findById(id: string): Promise<AuthUser | null> {
    const user = await this.clientProvider().user.findUnique({ where: { id } });
    return user as AuthUser | null;
  }

  async create(data: NewAuthUser): Promise<AuthUser> {
    const user = await this.clientProvider().user.create({ data });
    return user as AuthUser;
  }
}

