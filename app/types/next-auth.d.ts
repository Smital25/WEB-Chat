import "next-auth";
declare module "next-auth" {
  interface Session {
    user: { id: string } & import("next-auth").DefaultSession["user"];
  }
}