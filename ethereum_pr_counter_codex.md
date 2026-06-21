# Ethereum GitHub Developers PR Counter

## Objetivo

Crear un script que recorra todos los repositorios públicos de la organización `ethereum` en GitHub (`https://github.com/ethereum`) y obtenga todos los usuarios a los que se les haya mergeado al menos una Pull Request.

El resultado debe guardarse en un archivo `.csv` sencillo con estas columnas:

```csv
usuario,n_prs
```

Donde:

- `usuario`: login de GitHub del autor de la PR.
- `n_prs`: número total de Pull Requests mergeadas de ese usuario dentro de todos los repositorios públicos de `github.com/ethereum`.

Con este CSV luego se podrá calcular el total de developers únicos y ordenar por número de PRs.

---

## Requisitos funcionales

### 1. Recorrer todos los repositorios de la organización `ethereum`

Usar la GitHub API para listar todos los repositorios públicos de la organización:

```http
GET /orgs/ethereum/repos
```

Hay que tener en cuenta la paginación.

Parámetros recomendados:

```text
per_page=100
page=N
```

El script debe seguir pidiendo páginas hasta que no queden más repositorios.

---

### 2. Obtener todas las Pull Requests mergeadas de cada repositorio

Para cada repositorio, obtener las PRs cerradas:

```http
GET /repos/ethereum/{repo}/pulls
```

Parámetros recomendados:

```text
state=closed
per_page=100
page=N
```

Una Pull Request cuenta solo si está mergeada.

Para comprobarlo, se puede usar el campo:

```json
"merged_at"
```

Si `merged_at` es distinto de `null`, la PR debe contarse.

---

### 3. Contabilizar PRs por usuario

Para cada PR mergeada:

- Leer el autor en `pull_request.user.login`.
- Si el usuario no existe todavía en el diccionario contador, inicializarlo a 0.
- Sumar 1 al contador de ese usuario.

Ejemplo conceptual:

```python
counts[login] += 1
```

Solo deben aparecer usuarios con al menos 1 PR mergeada.

---

### 4. Generar CSV final

Crear un archivo llamado:

```text
ethereum_merged_pr_authors.csv
```

Con estas columnas:

```csv
usuario,n_prs
```

Ordenar preferiblemente por `n_prs` de mayor a menor.

Ejemplo de salida:

```csv
usuario,n_prs
alice,123
bob,57
charlie,12
```

---

## Requisitos técnicos

### Lenguaje recomendado

Python 3.

### Librerías recomendadas

Usar librerías estándar siempre que sea posible:

```python
import csv
import os
import time
import requests
from collections import Counter
```

También puede usarse `PyGithub`, pero se prefiere `requests` para que sea más transparente y fácil de auditar.

---

## Autenticación

El script debe usar un token de GitHub si está disponible para evitar límites bajos de rate limit.

Leer el token desde una variable de entorno:

```bash
GITHUB_TOKEN
```

Ejemplo:

```bash
export GITHUB_TOKEN="your_github_token_here"
```

En Windows PowerShell:

```powershell
$env:GITHUB_TOKEN="your_github_token_here"
```

Si no existe token, el script puede continuar sin autenticación, pero debe avisar de que puede alcanzar el rate limit rápidamente.

---

## Manejo de rate limits

El script debe manejar correctamente los límites de la API de GitHub.

Cada respuesta puede incluir headers como:

```text
X-RateLimit-Remaining
X-RateLimit-Reset
```

Si `X-RateLimit-Remaining` llega a `0`, el script debe esperar hasta `X-RateLimit-Reset`.

Lógica esperada:

1. Leer `X-RateLimit-Remaining`.
2. Si es `0`, leer `X-RateLimit-Reset`.
3. Calcular cuántos segundos faltan.
4. Hacer `sleep` hasta que se pueda continuar.

También conviene añadir una pequeña pausa entre requests para evitar abusos:

```python
time.sleep(0.1)
```

---

## Paginación

Todas las llamadas que devuelvan listas deben paginarse.

Crear una función genérica tipo:

```python
def github_get_paginated(url, params=None):
    ...
```

Esta función debe:

1. Pedir páginas con `per_page=100`.
2. Revisar el header `Link`.
3. Continuar mientras exista una página `next`.
4. Devolver todos los items acumulados.

Alternativamente, puede incrementar `page` manualmente hasta que la respuesta devuelva una lista vacía.

---

## Logs mínimos

El script debe imprimir progreso por consola:

```text
Fetching repositories from ethereum...
Found X repositories.
Processing repo 1/X: go-ethereum
Processing repo 2/X: solidity
...
Done.
Wrote ethereum_merged_pr_authors.csv
Total unique users: N
Total merged PRs counted: M
```

Si un repositorio falla, no debe romper todo el proceso. Debe registrar el error y continuar con el siguiente repo.

---

## Consideraciones importantes

### No contar issues

GitHub trata Pull Requests e Issues de forma relacionada internamente, pero aquí solo deben contarse Pull Requests.

No usar únicamente el endpoint de issues porque podría mezclar issues normales y PRs.

---

### No contar PRs cerradas sin mergear

Una PR cerrada pero no mergeada no cuenta.

Solo cuenta si:

```python
pr["merged_at"] is not None
```

---

### No contar commits directamente

El objetivo no es contar commits, sino PRs mergeadas.

Un usuario con una PR mergeada cuenta como developer aunque solo tenga una PR.

---

### Bots

Por defecto, incluir todos los usuarios, incluidos bots.

No filtrar bots automáticamente.

Si se quiere filtrar después, se podrá hacer desde el CSV.

---

## Resultado esperado

Al ejecutar:

```bash
python ethereum_pr_counter.py
```

Debe generarse:

```text
ethereum_merged_pr_authors.csv
```

Con formato:

```csv
usuario,n_prs
user1,120
user2,87
user3,44
```

---

## Script sugerido

Crear un archivo llamado:

```text
ethereum_pr_counter.py
```

Con una implementación completa que:

1. Lee `GITHUB_TOKEN`.
2. Lista todos los repositorios públicos de `ethereum`.
3. Recorre todas las PRs cerradas de cada repo.
4. Cuenta únicamente las PRs mergeadas.
5. Agrupa por autor.
6. Escribe el CSV final.
7. Imprime totales.

---

## Criterios de aceptación

El trabajo se considerará correcto si:

- El script recorre todos los repositorios públicos de `github.com/ethereum`.
- El script contempla paginación.
- El script solo cuenta PRs con `merged_at != null`.
- El CSV generado tiene exactamente las columnas:
  - `usuario`
  - `n_prs`
- El CSV está ordenado de mayor a menor por número de PRs.
- El script muestra por consola:
  - Total de repositorios procesados.
  - Total de usuarios únicos.
  - Total de PRs mergeadas contabilizadas.
- El script no se rompe por un fallo puntual en un repositorio.
- El token de GitHub nunca se escribe en el código fuente.
