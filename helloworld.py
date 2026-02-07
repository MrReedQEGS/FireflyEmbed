from js import document

output = document.getElementById("output")
output.innerHTML = "<b>helloworld.py loaded and running!</b> 🚀"

print("This prints to the PyScript console")

for i in range(1,10):
  print("Hello : " + str(i))
