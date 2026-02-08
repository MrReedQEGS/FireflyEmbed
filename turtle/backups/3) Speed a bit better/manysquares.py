import turtle
bob = turtle.Turtle()
bob.speed(3)
for j in range(6):    
    for i in range(4):
        bob.forward(20)
        bob.left(90)
    bob.penup()
    bob.forward(13)
    bob.pendown()