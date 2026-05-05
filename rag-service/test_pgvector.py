import asyncio
import asyncpg

async def main():
    pool = await asyncpg.create_pool("postgresql://postgres:postgres@localhost:5432/postgres")
    try:
        async with pool.acquire() as conn:
            await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            await conn.execute("CREATE TABLE IF NOT EXISTS test_vec (emb vector(3))")
            try:
                # pass a list of floats
                await conn.execute("INSERT INTO test_vec (emb) VALUES ($1)", [1.0, 2.0, 3.0])
                print("SUCCESS with list")
            except Exception as e:
                print(f"FAILED with list: {type(e).__name__} - {e}")
                
            try:
                await conn.execute("INSERT INTO test_vec (emb) VALUES ($1)", str([1.0, 2.0, 3.0]))
                print("SUCCESS with str(list)")
            except Exception as e:
                print(f"FAILED with str: {type(e).__name__} - {e}")
    finally:
        await pool.close()

asyncio.run(main())
