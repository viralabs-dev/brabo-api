import { describe, expect, it } from 'vitest';
import { validarRedeDoContainer } from '../../src/domain/containers/rede-do-container';
// Import RELATIVO só em teste: a api não consome o pacote em src/.
import {
  dnsValidado,
  hostsExtrasValidados,
  portasValidadas,
} from '../../../../packages/docker-port/src/spec-de-container';

type P = { host: number; container: number; protocol: string };
type H = { name: string; ip: string };

const ok = (f: () => unknown) => {
  try {
    f();
    return true;
  } catch {
    return false;
  }
};

/** A régua da api (artefato) tem de aceitar/recusar o mesmo que a do docker-port. */
describe('rede do container — paridade com o docker-port (AT-608, RN-931)', () => {
  const portas: P[][] = [
    [{ host: 8080, container: 3000, protocol: 'tcp' }],
    [{ host: 80, container: 3000, protocol: 'tcp' }],
    [{ host: 3000, container: 3000, protocol: 'tcp' }],
    [{ host: 8080, container: 1, protocol: 'udp' }],
    [
      { host: 8080, container: 1, protocol: 'tcp' },
      { host: 8080, container: 2, protocol: 'tcp' },
    ],
    Array.from({ length: 11 }, (_, i) => ({
      host: 9000 + i,
      container: 1,
      protocol: 'tcp',
    })),
  ];
  const dnss: string[][] = [
    ['1.1.1.1'],
    ['::1'],
    ['nao-ip'],
    ['1.1.1.1', '8.8.8.8', '9.9.9.9', '1.0.0.1'],
  ];
  const hosts: H[][] = [
    [{ name: 'api.local', ip: '10.0.0.5' }],
    [{ name: 'localhost', ip: '10.0.0.5' }],
    [{ name: 'brabo-x', ip: '10.0.0.5' }],
    [{ name: 'Maiusc', ip: '10.0.0.5' }],
    [{ name: 'ok.local', ip: '::1' }],
    [{ name: '-x', ip: '10.0.0.5' }],
  ];

  it.each(portas.map((p, i) => [i, p] as const))('portas %i', (_i, p) => {
    expect(ok(() => validarRedeDoContainer({ ports: p }))).toBe(
      ok(() =>
        portasValidadas(
          p.map((x) => ({
            host: x.host,
            container: x.container,
            protocolo: x.protocol,
          })),
        ),
      ),
    );
  });

  it.each(dnss.map((d, i) => [i, d] as const))('dns %i', (_i, d) => {
    expect(ok(() => validarRedeDoContainer({ dns: d }))).toBe(
      ok(() => dnsValidado(d)),
    );
  });

  it.each(hosts.map((h, i) => [i, h] as const))('hosts %i', (_i, h) => {
    expect(ok(() => validarRedeDoContainer({ extraHosts: h }))).toBe(
      ok(() =>
        hostsExtrasValidados(h.map((x) => ({ nome: x.name, ip: x.ip }))),
      ),
    );
  });

  it('a recusa nomeia o campo', () => {
    expect(() =>
      validarRedeDoContainer({
        ports: [{ host: 80, container: 1, protocol: 'tcp' }],
      }),
    ).toThrow(/ports\[0\]\.host/);
  });
});
