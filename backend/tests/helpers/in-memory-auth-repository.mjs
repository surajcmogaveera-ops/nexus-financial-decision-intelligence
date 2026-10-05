export class InMemoryAuthUserRepository {
  constructor(users = []) {
    this.usersById = new Map(users.map((user) => [user.id, structuredClone(user)]));
    this.usersByEmail = new Map(users.map((user) => [user.email, structuredClone(user)]));
    this.nextId = 1;
  }

  async findByEmail(email) {
    const user = this.usersByEmail.get(email);
    return user ? structuredClone(user) : null;
  }

  async findById(id) {
    const user = this.usersById.get(id);
    return user ? structuredClone(user) : null;
  }

  async create(data) {
    if (this.usersByEmail.has(data.email)) {
      const error = new Error("unique constraint");
      error.code = "P2002";
      error.meta = { target: ["email"] };
      throw error;
    }
    const id = `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`;
    const user = { id, ...structuredClone(data) };
    this.usersById.set(id, user);
    this.usersByEmail.set(user.email, user);
    return structuredClone(user);
  }
}
