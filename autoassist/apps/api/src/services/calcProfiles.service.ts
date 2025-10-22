// src/services/calcProfiles.service.ts
import prisma from '../utils/prisma.js';

export type CalcProfileInput = {
  code: string; // ECONOMY | STANDARD | PREMIUM | custom
  name: string;
  partsCoeff?: number;
  laborCoeff?: number;
  nightCoeff?: number;
  urgentCoeff?: number;
  suvCoeff?: number;
  laborRate?: number;
  active?: boolean;
};

export async function listProfiles() {
  return prisma.calcProfile.findMany({ orderBy: { code: 'asc' } });
}

export async function createProfile(input: CalcProfileInput) {
  return prisma.calcProfile.create({
    data: {
      code: input.code,
      name: input.name,
      partsCoeff: input.partsCoeff ?? 1.0,
      laborCoeff: input.laborCoeff ?? 1.0,
      nightCoeff: input.nightCoeff ?? 1.0,
      urgentCoeff: input.urgentCoeff ?? 1.0,
      suvCoeff: input.suvCoeff ?? 1.0,
      laborRate: input.laborRate ?? 400,
      active: input.active ?? true,
    },
  });
}

export async function updateProfile(id: number, input: Partial<CalcProfileInput>) {
  return prisma.calcProfile.update({
    where: { id: Number(id) },
    data: {
      ...(input.code ? { code: input.code } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.partsCoeff != null ? { partsCoeff: input.partsCoeff } : {}),
      ...(input.laborCoeff != null ? { laborCoeff: input.laborCoeff } : {}),
      ...(input.nightCoeff != null ? { nightCoeff: input.nightCoeff } : {}),
      ...(input.urgentCoeff != null ? { urgentCoeff: input.urgentCoeff } : {}),
      ...(input.suvCoeff != null ? { suvCoeff: input.suvCoeff } : {}),
      ...(input.laborRate != null ? { laborRate: input.laborRate } : {}),
      ...(input.active != null ? { active: input.active } : {}),
    },
  });
}

export async function deleteProfile(id: number) {
  await prisma.calcProfile.delete({ where: { id: Number(id) } });
  return { ok: true };
}
