export interface JwtPayload {
  sub: string; // user id
  phone: string;
  isSeller: boolean;
}
