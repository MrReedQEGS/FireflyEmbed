# main.py (runs inside the worker)
# IMPORTANT: do not call input() at top-level; only inside the function.

async def run_program():
    print("Program started ✅")
    name = input("What is your name? ")
    age = input("How old are you? ")
    print(f"Hello {name}, you are {age} years old.")

# Export functions the main thread can call:
__export__ = ["run_program"]
